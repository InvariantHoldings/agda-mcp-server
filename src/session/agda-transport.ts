import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import type { AgdaResponse } from "../agda/types.js";
import { normalizeAgdaResponse } from "../agda/normalize-response.js";
import { logger } from "../agda/logger.js";
import { terminateAgdaProcess } from "../agda/agda-process-spawn.js";
import {
  type CommandCompletionOrigin,
  configuredCommandTimeoutMs,
  configuredWaitingSentryMs,
  idleCompletionDelay,
  shouldResolveOnIdle,
  summarizeResponseKinds,
  tailResponsePreview,
  trailingResponseDelay,
} from "./command-completion.js";
import { parseAgdaStdoutLine } from "./stdout-line.js";

/**
 * Marker error raised when an in-flight `transport.sendCommand` is
 * interrupted by an Agda control command (`Cmd_abort` / `Cmd_exit`)
 * via `rejectInFlightCommand`. Callers that catch transport errors
 * for retry / best-effort purposes (e.g. `preflightVersionDetection`)
 * MUST re-throw this class — swallowing it lets the queued
 * control command wait its turn behind the user command instead of
 * cancelling it, which defeats the IOTCM-level intent of `Cmd_abort`.
 */
export class ControlCommandInterruption extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ControlCommandInterruption";
  }
}

/** Response kinds that belong exclusively to the control-command
 *  protocol path (`Cmd_abort` / `Cmd_exit`). Used to filter late
 *  echoes that arrive AFTER the fire-and-forget flush window closed
 *  but BEFORE the next regular `sendCommand` has settled — without
 *  this filter, a delayed `DoneAborting` would otherwise land in the
 *  next regular command's response queue (or trip its idle-completion
 *  timer) and corrupt it. */
const CONTROL_RESPONSE_KINDS: ReadonlySet<string> = new Set([
  "DoneAborting",
  "DoneExiting",
]);

/** Default budget after which `sendFireAndForgetCommand` terminates a
 *  proc that hasn't acknowledged the control command. Catches wedged
 *  Agda processes that can't service `Cmd_abort` / `Cmd_exit` — the
 *  original `sendCommand`'s per-command timeout was cancelled by the
 *  `rejectInFlightCommand` interrupt, so without this fallback nothing
 *  would reap the child. Overridable per-call. */
const DEFAULT_CONTROL_ESCALATION_MS = 5_000;

export class AgdaTransport {
  buffer = "";
  responseQueue: AgdaResponse[] = [];
  emitter = new EventEmitter();
  collecting = false;
  private currentCommandKind: "regular" | "control" | null = null;
  private sawStatusDone = false;
  private idleDoneTimer: NodeJS.Timeout | null = null;
  private controlEscalationTimer: NodeJS.Timeout | null = null;
  private lastResponseAt: number | null = null;
  private lastResponseKind: string | null = null;

  handleStdout(chunk: Buffer): void {
    // Drop stdout that arrives while we're not collecting. After the
    // per-command timeout fires `finish()` flips `collecting` to false
    // but the killed proc's stdout listener stays attached until the
    // next `ensureProcess()` detaches it. Without this early-return a
    // late partial line from the dying child would sit in `this.buffer`
    // and corrupt the parse of the replacement Agda's first line.
    if (!this.collecting) return;
    this.buffer += chunk.toString();
    this.drainBuffer();
  }

  handleStderr(chunk: Buffer): void {
    if (!this.collecting) {
      return;
    }

    this.recordCollectedResponse({
      kind: "StderrOutput",
      text: chunk.toString(),
    });
  }

  handleProcessClose(): void {
    this.collecting = false;
    this.clearIdleCompletionTimer();
    this.emitter.emit("done", "process-close");
  }

  handleProcessError(error: Error): void {
    this.emitter.emit("error", error);
  }

  /** Reset transport state and unblock any in-flight `sendCommand`
   *  so a caller invoking `session.destroy()` mid-command isn't
   *  stuck waiting for the per-command timeout. */
  destroy(): void {
    this.clearIdleCompletionTimer();
    this.clearControlEscalationTimer();
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = false;
    this.currentCommandKind = null;
    this.sawStatusDone = false;
    this.lastResponseAt = null;
    this.lastResponseKind = null;
    this.rejectInFlightCommand("AgdaTransport destroyed while command was in flight");
  }

  /** Emit `"error"` on the shared emitter so any active `sendCommand`
   *  Promise rejects promptly. `listenerCount` guards EventEmitter's
   *  "unhandled error" throw when no command is in flight.
   *
   *  Public so `AgdaSession.sendControlCommand` can interrupt an
   *  in-flight transport command synchronously, *before* queueing the
   *  fire-and-forget write through the session command queue.
   *
   *  Pass `controlCommand: true` from the control-command path so the
   *  rejection is a `ControlCommandInterruption` — best-effort error
   *  catchers (e.g. `preflightVersionDetection`) re-throw that class
   *  rather than swallow it, ensuring the queued abort/exit cancels
   *  the user command instead of waiting behind it. */
  rejectInFlightCommand(reason: string, options: { controlCommand?: boolean } = {}): boolean {
    if (this.emitter.listenerCount("error") === 0) return false;
    const err = options.controlCommand
      ? new ControlCommandInterruption(reason)
      : new Error(reason);
    this.emitter.emit("error", err);
    return true;
  }

  /** Write a fire-and-forget IOTCM control command (e.g. `Cmd_abort`,
   *  `Cmd_exit`) and resolve after a short flush window. Unlike
   *  `sendCommand`, this MUST NOT reject on the budget elapsing and
   *  MUST NOT terminate the subprocess: Agda legitimately emits no
   *  response when there is no in-progress operation to abort (or
   *  emits a delayed `DoneAborting`/`DoneExiting` that we capture if
   *  it arrives within the flush window). Resolving the Promise after
   *  `flushMs` gives the protocol time to land a closing response
   *  without forcing the tool layer to wait the full per-command
   *  timeout — and without falsely turning a healthy proc into a
   *  zombie via the timeout-driven kill path. */
  sendFireAndForgetCommand(
    proc: ChildProcess,
    command: string,
    options: { flushMs?: number; escalationMs?: number } = {},
  ): Promise<AgdaResponse[]> {
    const flushMs = options.flushMs ?? 250;
    const escalationMs = options.escalationMs ?? DEFAULT_CONTROL_ESCALATION_MS;
    logger.trace("sendFireAndForgetCommand", {
      command: command.slice(0, 200),
      flushMs,
      escalationMs,
    });
    // If a regular `sendCommand` is in flight, interrupt it before
    // we clobber the shared `buffer`/`responseQueue`/`collecting`
    // state — the in-flight command's responses would otherwise be
    // dropped on the floor and it would eventually time out.
    // Interrupting is also the protocol-level intent of `Cmd_abort`
    // and `Cmd_exit`: they exist precisely to cancel the active
    // command, not to wait their turn behind it.
    //
    // The boolean return tells us whether there was actually
    // something to interrupt — used below to gate the
    // kill-escalation timer so we don't SIGTERM a healthy idle
    // session for issuing `Cmd_abort` as a no-op.
    const wasInterruptingInFlight = this.rejectInFlightCommand(
      "Interrupted by Agda control command",
      { controlCommand: true },
    );
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = true;
    this.currentCommandKind = "control";
    this.sawStatusDone = false;
    this.lastResponseAt = null;
    this.lastResponseKind = null;

    // Kill-escalation fallback for a wedged Agda that fails to
    // service the control command. Only armed when we ACTUALLY
    // interrupted an in-flight command — if the session was idle
    // (no in-flight to abort) `Cmd_abort` is a legitimate no-op
    // and SIGTERMing the proc 5s later would kill a perfectly
    // healthy session. The timer is also cleared when we observe
    // `DoneAborting` / `DoneExiting` on the wire (see
    // `recordCollectedResponse` — proof the proc serviced the
    // control command and is therefore not wedged), so a healthy
    // proc that acknowledges and stays alive isn't reaped either.
    // `unref()`'d so it never keeps Node alive past shutdown.
    this.clearControlEscalationTimer();
    if (wasInterruptingInFlight && escalationMs > 0) {
      this.controlEscalationTimer = setTimeout(() => {
        this.controlEscalationTimer = null;
        if (proc.exitCode === null && proc.signalCode === null) {
          logger.warn("Control command not acknowledged; terminating proc", {
            command: command.slice(0, 120),
            escalationMs,
          });
          terminateAgdaProcess(proc);
        }
      }, escalationMs);
      this.controlEscalationTimer.unref();
      // Optional chaining: production `ChildProcess` always exposes
      // `once`, but the transport unit tests pass minimal mock procs
      // that don't, and we'd rather not crash the production code
      // path defensively from a fake-proc shape.
      proc.once?.("close", () => this.clearControlEscalationTimer());
    }

    return new Promise<AgdaResponse[]>((resolve) => {
      const settle = () => {
        const responses = [...this.responseQueue];
        this.collecting = false;
        this.clearIdleCompletionTimer();
        this.emitter.removeListener("error", onError);
        clearTimeout(flushTimer);
        resolve(responses);
      };
      // Fire-and-forget contract: never reject. If the subprocess
      // emits `error` (or `destroy()` rejects in-flight) during the
      // flush window, resolve with whatever responses we've collected
      // so far rather than letting an unhandled emitter error crash
      // Node. The previous `sendCommand` path installed an `error`
      // listener for the same reason.
      const onError = () => settle();
      const flushTimer = setTimeout(settle, flushMs);
      this.emitter.on("error", onError);
      proc.stdin?.write(`${command}\n`);
    });
  }

  sendCommand(
    proc: ChildProcess,
    command: string,
    timeoutMs = configuredCommandTimeoutMs(),
  ): Promise<AgdaResponse[]> {
    logger.trace("sendCommand", { command: command.slice(0, 200), timeoutMs });
    const startTime = Date.now();

    // Clear the buffer at command start so any late stdout from a
    // killed-but-not-yet-detached predecessor process cannot be
    // concatenated with the first JSON line from a replacement Agda.
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = true;
    this.currentCommandKind = "regular";
    this.sawStatusDone = false;
    this.lastResponseAt = null;
    this.lastResponseKind = null;

    return new Promise<AgdaResponse[]>((resolveCmd, rejectCmd) => {
      const sentryIntervalMs = configuredWaitingSentryMs();
      const waitingSentry = sentryIntervalMs > 0
        ? setInterval(() => {
            logger.warn("sendCommand still waiting", {
              command: command.slice(0, 100),
              elapsedMs: Date.now() - startTime,
              responseCount: this.responseQueue.length,
              sawStatusDone: this.sawStatusDone,
              msSinceLastResponse: this.lastResponseAt === null
                ? null
                : Date.now() - this.lastResponseAt,
              lastResponseKind: this.lastResponseKind,
              responseKinds: summarizeResponseKinds(this.responseQueue),
              responseTail: tailResponsePreview(this.responseQueue),
            });
          }, sentryIntervalMs)
        : null;

      const finish = (handler: () => void) => {
        this.collecting = false;
        this.clearIdleCompletionTimer();
        if (waitingSentry) {
          clearInterval(waitingSentry);
        }
        this.emitter.removeListener("done", onDone);
        this.emitter.removeListener("error", onError);
        handler();
      };

      const timeout = setTimeout(() => {
        const responseCount = this.responseQueue.length;
        const responseKinds = summarizeResponseKinds(this.responseQueue);
        logger.warn("sendCommand timed out", {
          command: command.slice(0, 100),
          timeoutMs,
          responseCount,
          sawStatusDone: this.sawStatusDone,
          elapsedMs: Date.now() - startTime,
          msSinceLastResponse: this.lastResponseAt === null
            ? null
            : Date.now() - this.lastResponseAt,
          lastResponseKind: this.lastResponseKind,
          responseKinds,
          responseTail: tailResponsePreview(this.responseQueue),
        });
        terminateAgdaProcess(proc);
        this.buffer = "";
        finish(() => {
          rejectCmd(new Error(
            `sendCommand timed out after ${timeoutMs}ms ` +
            `(received ${responseCount} responses: ${JSON.stringify(responseKinds)})`,
          ));
        });
      }, timeoutMs);

      const onDone = (origin: CommandCompletionOrigin = "signal") => {
        const trailingDelay = trailingResponseDelay({
          sawStatusDone: this.sawStatusDone,
          responseCount: this.responseQueue.length,
          lastResponseKind: this.lastResponseKind,
        }, origin);

        setTimeout(() => {
          clearTimeout(timeout);
          finish(() => {
            const responses = [...this.responseQueue];
            logger.trace("sendCommand done", {
              responses: responses.length,
              durationMs: Date.now() - startTime,
            });
            resolveCmd(responses);
          });
        }, trailingDelay);
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        finish(() => {
          rejectCmd(err);
        });
      };

      this.emitter.on("done", onDone);
      this.emitter.on("error", onError);

      proc.stdin?.write(`${command}\n`);
    });
  }

  private drainBuffer(): void {
    let start = 0;
    let newlineIdx: number;

    while ((newlineIdx = this.buffer.indexOf("\n", start)) !== -1) {
      const line = this.buffer.slice(start, newlineIdx);
      start = newlineIdx + 1;

      const parsedLine = parseAgdaStdoutLine(line);
      if (parsedLine.noticeText) {
        this.recordCollectedResponse({
          kind: "StderrOutput",
          text: parsedLine.noticeText,
        });
      }

      if (!parsedLine.jsonText) {
        continue;
      }

      try {
        const response = normalizeAgdaResponse(JSON.parse(parsedLine.jsonText));
        this.recordCollectedResponse(response);
      } catch {
        logger.trace("Skipped unparseable line", { line: line.slice(0, 120) });
      }
    }

    if (start > 0) {
      this.buffer = this.buffer.slice(start);
    }
  }

  private recordCollectedResponse(response: AgdaResponse): void {
    if (!this.collecting) {
      return;
    }

    // Drop late control-command echoes that arrive after our flush
    // window closed but before the next regular command settled.
    // `DoneAborting` / `DoneExiting` belong exclusively to the
    // `Cmd_abort` / `Cmd_exit` path; collecting them into a regular
    // command's queue corrupts the response set (and would trip the
    // idle-completion timer's heuristics). The kind check is
    // necessary because Agda gives us no per-command tag on
    // responses — once they're on stdout, only the kind tells us
    // which command they belong to.
    if (
      this.currentCommandKind === "regular" &&
      CONTROL_RESPONSE_KINDS.has(response.kind)
    ) {
      logger.trace("Dropped late control-command echo during regular command", {
        kind: response.kind,
      });
      return;
    }

    // Inside a control command, a `DoneAborting` / `DoneExiting`
    // payload proves the proc serviced our request and is therefore
    // not wedged — clear the kill-escalation timer so we don't
    // SIGTERM a healthy session a few seconds later.
    if (
      this.currentCommandKind === "control" &&
      CONTROL_RESPONSE_KINDS.has(response.kind)
    ) {
      this.clearControlEscalationTimer();
    }

    this.responseQueue.push(response);
    this.lastResponseAt = Date.now();
    this.lastResponseKind = response.kind;

    if (response.kind === "Status") {
      this.sawStatusDone = true;
    }

    this.bumpIdleCompletionTimer();
  }

  private clearIdleCompletionTimer(): void {
    if (this.idleDoneTimer) {
      clearTimeout(this.idleDoneTimer);
      this.idleDoneTimer = null;
    }
  }

  private clearControlEscalationTimer(): void {
    if (this.controlEscalationTimer) {
      clearTimeout(this.controlEscalationTimer);
      this.controlEscalationTimer = null;
    }
  }

  private bumpIdleCompletionTimer(): void {
    this.clearIdleCompletionTimer();

    if (!this.collecting) {
      return;
    }

    if (!shouldResolveOnIdle({
      sawStatusDone: this.sawStatusDone,
      responseCount: this.responseQueue.length,
      lastResponseKind: this.lastResponseKind,
    })) {
      return;
    }

    this.idleDoneTimer = setTimeout(() => {
      if (!this.collecting) {
        return;
      }

      logger.trace("sendCommand idle-complete", {
        responses: this.responseQueue.length,
        sawStatusDone: this.sawStatusDone,
        lastResponseKind: this.lastResponseKind,
      });
      this.emitter.emit("done", "idle");
    }, idleCompletionDelay({
      sawStatusDone: this.sawStatusDone,
      responseCount: this.responseQueue.length,
      lastResponseKind: this.lastResponseKind,
    }));
  }
}
