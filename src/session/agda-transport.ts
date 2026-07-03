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
  trailingResponseDelay,
} from "./command-completion.js";
import { parseAgdaStdoutLine } from "./stdout-line.js";
import { GoalTerminusTracker } from "./goal-terminus.js";
import { waitDiagnostics as buildWaitDiagnostics } from "./command-wait-diagnostics.js";

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
  // Re-arms the in-flight command's inactivity timeout on each response so
  // the timeout measures silence, not elapsed time. Set only during a
  // regular sendCommand; null otherwise.
  private resetInactivityTimer: (() => void) | null = null;
  private lastResponseAt: number | null = null;
  private lastResponseKind: string | null = null;
  // When set (a Cmd_load), hold idle completion until the goal-state
  // terminus tracked here arrives — see GoalTerminusTracker.
  private awaitGoalTerminus = false;
  private readonly goalTerminus = new GoalTerminusTracker();

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
    this.resetInactivityTimer = null;
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
   *  `Cmd_exit`) and resolve after a short flush window. Never rejects —
   *  Agda may emit no response, or a delayed `DoneAborting`/`DoneExiting`.
   *  When `armEscalation` and `escalationMs > 0`, an `unref()`'d timer
   *  terminates the proc after `escalationMs` unless it closes or emits a
   *  control-echo. Caller decides: `Cmd_exit` always arms; `Cmd_abort`
   *  arms only if it interrupted an in-flight command (an idle abort is a
   *  no-op and must not kill a healthy proc). */
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
    // Interrupt any in-flight `sendCommand` before clobbering the shared
    // buffer/queue/collecting state. Usually already done synchronously by
    // the session path (so this is a no-op); the redundant call defends
    // direct-transport callers and tests. The escalation timer is gated by
    // the caller's explicit `armEscalation`, not this return value — by now
    // the motivating in-flight is gone and the listener check is always
    // false. See `dispatchSessionControlCommand`.
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
    // Control commands use the flush window; drop any stale watchdog re-arm.
    this.resetInactivityTimer = null;

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
    this.goalTerminus.reset();

    return new Promise<AgdaResponse[]>((resolveCmd, rejectCmd) => {
      const sentryIntervalMs = configuredWaitingSentryMs();
      const waitingSentry = sentryIntervalMs > 0
        ? setInterval(() => {
            logger.warn("sendCommand still waiting", this.waitDiagnostics(command, startTime));
          }, sentryIntervalMs)
        : null;

      let inactivityTimer: NodeJS.Timeout;

      const finish = (handler: () => void) => {
        this.collecting = false;
        this.clearIdleCompletionTimer();
        clearTimeout(inactivityTimer);
        this.resetInactivityTimer = null;
        if (waitingSentry) {
          clearInterval(waitingSentry);
        }
        this.emitter.removeListener("done", onDone);
        this.emitter.removeListener("error", onError);
        handler();
      };

      const onTimeout = () => {
        const responseCount = this.responseQueue.length;
        const responseKinds = summarizeResponseKinds(this.responseQueue);
        logger.warn("sendCommand timed out", this.waitDiagnostics(command, startTime, timeoutMs));
        terminateAgdaProcess(proc);
        this.buffer = "";
        finish(() => {
          rejectCmd(new Error(
            `sendCommand timed out after ${timeoutMs}ms of inactivity ` +
            `(received ${responseCount} responses: ${JSON.stringify(responseKinds)})`,
          ));
        });
      };

      // Inactivity watchdog: reset on each response so it fires only after
      // `timeoutMs` of silence, not of total work. A dead proc still gets
      // reaped; a slow module emitting progress does not.
      const armTimeout = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(onTimeout, timeoutMs);
      };
      this.resetInactivityTimer = armTimeout;
      armTimeout();

      const onDone = (origin: CommandCompletionOrigin = "signal") => {
        const trailingDelay = trailingResponseDelay({
          sawStatusDone: this.sawStatusDone,
          responseCount: this.responseQueue.length,
          lastResponseKind: this.lastResponseKind,
        }, origin);

        setTimeout(() => {
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
    if (this.awaitGoalTerminus) this.goalTerminus.record(response);

    // Progress arrived — push back the inactivity watchdog.
    this.resetInactivityTimer?.();
    this.bumpIdleCompletionTimer();
  }

  private waitDiagnostics(
    command: string,
    startTime: number,
    timeoutMs?: number,
  ): Record<string, unknown> {
    return buildWaitDiagnostics({
      command,
      startTimeMs: startTime,
      nowMs: Date.now(),
      responseQueue: this.responseQueue,
      sawStatusDone: this.sawStatusDone,
      lastResponseAt: this.lastResponseAt,
      lastResponseKind: this.lastResponseKind,
      timeoutMs,
    });
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

    const snapshot = {
      sawStatusDone: this.sawStatusDone,
      responseCount: this.responseQueue.length,
      lastResponseKind: this.lastResponseKind,
      awaitGoalTerminus: this.awaitGoalTerminus,
      sawGoalTerminus: this.goalTerminus.reached(),
    };
    if (!shouldResolveOnIdle(snapshot)) {
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
    }, idleCompletionDelay(snapshot));
  }
}
