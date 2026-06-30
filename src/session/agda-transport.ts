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

/** Response kinds emitted only by `Cmd_abort`/`Cmd_exit`. Used both
 *  to filter late echoes out of regular-command response queues and
 *  to detect proc responsiveness so the kill-escalation timer can
 *  be cleared. */
const CONTROL_RESPONSE_KINDS: ReadonlySet<string> = new Set([
  "DoneAborting",
  "DoneExiting",
]);

/** Default budget for the wedged-proc kill escalation. Overridable
 *  per-call via `sendFireAndForgetCommand`'s options. */
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
  // Goal-terminus tracking for a metas `Cmd_load`. Per the documented
  // load sequence (tooling/protocol/data/official-cross-version-notes.json)
  // a Cmd_load always emits InteractionPoints + AllGoalsWarnings; on a
  // type error it emits a DisplayInfo Error instead. We must not resolve
  // the command until that terminus is on the wire, since on a large
  // module Agda pauses to compute it (the gap that dropped goals/errors
  // pre-fix). Only armed when `awaitGoalTerminus` is set; every other
  // command leaves these false and keeps the original fast idle path.
  private awaitGoalTerminus = false;
  private sawInteractionPoints = false;
  private sawAllGoalsWarnings = false;
  private sawLoadError = false;

  handleStdout(chunk: Buffer): void {
    // Drop stdout while idle UNLESS a control-command escalation
    // timer is still armed — a delayed `DoneAborting`/`DoneExiting`
    // arriving AFTER our flush window closed but BEFORE the
    // escalation budget elapses is proof the proc is responsive,
    // and `recordCollectedResponse` uses it to clear the timer.
    // Without this carve-out the late echo would be dropped here
    // and the timer would later SIGTERM a healthy proc that did
    // service the control command.
    //
    // The default `!collecting` drop is still important: after the
    // per-command timeout fires `finish()` flips `collecting` to
    // false but the killed proc's stdout listener stays attached
    // until the next `ensureProcess()` detaches it, and a stale
    // partial line sitting in `this.buffer` would corrupt the parse
    // of the replacement Agda's first JSON line.
    if (!this.collecting && !this.controlEscalationTimer) return;
    this.buffer += chunk.toString();
    this.drainBuffer();
  }

  handleStderr(chunk: Buffer): void {
    // Stderr while idle is never a control-echo so the more
    // permissive `controlEscalationTimer` carve-out from
    // `handleStdout` doesn't apply here.
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
    this.awaitGoalTerminus = false;
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

  /** Write a fire-and-forget IOTCM control command (`Cmd_abort` /
   *  `Cmd_exit`) and resolve after a short flush window. The Promise
   *  itself never rejects — Agda may legitimately emit no response,
   *  or emit a delayed `DoneAborting`/`DoneExiting` we capture if
   *  it arrives in time.
   *
   *  Background safety net: if `armEscalation` is true and
   *  `escalationMs > 0`, an `unref()`'d timer terminates the proc
   *  after `escalationMs` unless it closes or emits a control-echo
   *  (cleared in `recordCollectedResponse`). The caller decides
   *  whether to arm: `Cmd_exit` always arms; `Cmd_abort` arms only
   *  if a regular command was actually interrupted (an idle abort
   *  is a protocol no-op and must NOT kill a healthy proc). */
  sendFireAndForgetCommand(
    proc: ChildProcess,
    command: string,
    options: { flushMs?: number; escalationMs?: number; armEscalation?: boolean } = {},
  ): Promise<AgdaResponse[]> {
    const flushMs = options.flushMs ?? 250;
    const escalationMs = options.escalationMs ?? DEFAULT_CONTROL_ESCALATION_MS;
    logger.trace("sendFireAndForgetCommand", {
      command: command.slice(0, 200),
      flushMs,
      escalationMs,
      armEscalation: options.armEscalation,
    });
    // Interrupt any in-flight `sendCommand` before we clobber the
    // shared `buffer`/`responseQueue`/`collecting` state. The
    // session path has usually already done this synchronously
    // before queueing us, so by the time we run there is no
    // emitter listener left and this is a no-op; the redundant
    // call is defense for direct-transport callers (and unit
    // tests) that bypass the session.
    //
    // We do NOT trust the boolean return to gate the escalation
    // timer here — by the time this fire-and-forget task runs
    // through the session command queue, the in-flight that
    // motivated the abort is long gone, and the listener-count
    // check would always be false. The caller passes
    // `armEscalation` explicitly based on what it observed at the
    // moment the control command was *requested*. See
    // `dispatchSessionControlCommand` in
    // `session-command-dispatch.ts`.
    this.rejectInFlightCommand(
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
    this.awaitGoalTerminus = false;

    // Kill-escalation fallback for a wedged Agda that fails to
    // service the control command. Caller decides when to arm:
    //
    //   - `Cmd_abort` arms only when it actually interrupted an
    //     in-flight command. An idle abort is a protocol no-op
    //     and SIGTERMing the proc would kill a healthy session.
    //
    //   - `Cmd_exit` ALWAYS arms — exit is supposed to bring the
    //     proc down whether or not anything was in flight. A
    //     wedged proc that ignores Cmd_exit needs to be reaped.
    //
    // The timer is cleared on `DoneAborting`/`DoneExiting` (proof
    // the proc serviced the request — see `recordCollectedResponse`)
    // and on proc close. `unref()`'d so it never blocks Node exit.
    this.clearControlEscalationTimer();
    if (options.armEscalation === true && escalationMs > 0) {
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
    options: { awaitGoalTerminus?: boolean } = {},
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
    this.awaitGoalTerminus = options.awaitGoalTerminus ?? false;
    this.sawInteractionPoints = false;
    this.sawAllGoalsWarnings = false;
    this.sawLoadError = false;

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
    // Control-echo clearing runs FIRST, before any collecting / kind
    // gating. A `DoneAborting`/`DoneExiting` on the wire is proof
    // the proc serviced the control command; we want to clear the
    // kill-escalation timer regardless of whether `collecting` is
    // still true (it isn't if the flush window already closed) or
    // what the current command kind is (the echo can arrive AFTER
    // the next regular command has reset `currentCommandKind`).
    // Without this ordering the late-echo path L5 reopens.
    if (CONTROL_RESPONSE_KINDS.has(response.kind)) {
      this.clearControlEscalationTimer();
    }

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

    this.responseQueue.push(response);
    this.lastResponseAt = Date.now();
    this.lastResponseKind = response.kind;

    if (response.kind === "Status") {
      this.sawStatusDone = true;
    }
    this.recordGoalTerminusResponse(response);

    this.bumpIdleCompletionTimer();
  }

  /** Track the documented Cmd_load goal-state terminus (InteractionPoints
   *  + AllGoalsWarnings, or a DisplayInfo Error). Cheap field reads — no
   *  schema parse — since we only need the response/info kind. */
  private recordGoalTerminusResponse(response: AgdaResponse): void {
    if (!this.awaitGoalTerminus) return;
    if (response.kind === "InteractionPoints") {
      this.sawInteractionPoints = true;
    } else if (response.kind === "DisplayInfo") {
      const infoKind = (response.info as { kind?: unknown } | undefined)?.kind;
      if (infoKind === "AllGoalsWarnings") this.sawAllGoalsWarnings = true;
      else if (infoKind === "Error") this.sawLoadError = true;
    }
  }

  /** The awaited goal state is fully on the wire. A successful load needs
   *  both InteractionPoints and AllGoalsWarnings (order varies across
   *  Agda versions); a type error short-circuits via DisplayInfo Error. */
  private sawGoalTerminus(): boolean {
    return this.sawLoadError || (this.sawInteractionPoints && this.sawAllGoalsWarnings);
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
      awaitGoalTerminus: this.awaitGoalTerminus,
      sawGoalTerminus: this.sawGoalTerminus(),
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
      awaitGoalTerminus: this.awaitGoalTerminus,
      sawGoalTerminus: this.sawGoalTerminus(),
    }));
  }
}
