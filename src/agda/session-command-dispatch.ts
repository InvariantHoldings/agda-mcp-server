// MIT License — see LICENSE
//
// Command-dispatch helpers for `AgdaSession`. Extracted from
// `session.ts` so that file stays under the 500-line ceiling
// declared in `ARCHITECTURE.md` / `AGENTS.md`. Same pattern as
// `session-process-lifecycle.ts` and `session-load-impl.ts`: free
// functions that take an `AgdaSession` reference and mutate its
// module-internal state. External consumers should keep using the
// class methods on `AgdaSession` — these helpers are an
// implementation detail of how `sendCommand` and the control
// commands are serialised onto `commandQueue`.

import type { AgdaSession } from "./session.js";
import type { AgdaResponse } from "./types.js";
import { iotcmEnvelope } from "../protocol/command-builder.js";
import {
  piggybackVersionFromResponses,
  preflightVersionDetection,
} from "./agda-version-detection.js";
import {
  assertProcSurvivedPreflight,
  assertSessionAlive,
  resetFileBoundStateIfProcDied,
} from "./session-process-lifecycle.js";

/**
 * Serialise a user IOTCM command onto the session command queue,
 * run the version-detection preflight, send the user command, and
 * piggyback version detection out of the response stream. Throws if
 * the session has been destroyed, or if the preflight killed /
 * replaced the subprocess between command entry and the user
 * command's actual write to stdin.
 *
 * Preflight + survival assertions live inside a try/finally so
 * `resetFileBoundStateIfProcDied` runs on EVERY exit path — without
 * the finally a preflight timeout that killed the proc would leave
 * `currentFile`/`goalIds`/load metadata referring to a dead Agda
 * until the eventual `close` event landed.
 */
export function dispatchSessionCommand(
  session: AgdaSession,
  command: string,
  timeoutMs: number,
  options: { awaitGoalTerminus?: boolean } = {},
): Promise<AgdaResponse[]> {
  // Capture our serial number synchronously at enqueue time. When
  // our task body runs, `dispatchSessionControlCommand` may have
  // bumped `cancelledThrough` past this value — meaning a control
  // command (abort/exit) was issued AFTER we were queued but
  // BEFORE we got our turn at the queue. In that case we reject
  // without ever writing to stdin, so the control command isn't
  // starved behind backlog. See PR #56 review round 11 (L6).
  const mySerial = ++session.commandSerial;

  const task = session.commandQueue.then(async () => {
    assertSessionAlive(session);
    if (mySerial <= session.cancelledThrough) {
      throw new Error("Cancelled by Agda control command (Cmd_abort/Cmd_exit)");
    }

    const proc = session.ensureProcess();
    const fileAtStart = session.currentFile;

    let responses: AgdaResponse[];
    try {
      await preflightVersionDetection({
        state: session,
        transport: session.transport,
        proc,
        buildIotcm: (cmd) => iotcmEnvelope(session.currentFile ?? "", cmd),
        userCommand: command,
      });

      assertSessionAlive(session);
      assertProcSurvivedPreflight(session, proc, fileAtStart);

      responses = await session.transport.sendCommand(proc, command, timeoutMs, options);
    } finally {
      resetFileBoundStateIfProcDied(session, proc);
    }

    piggybackVersionFromResponses({
      state: session,
      responses,
      userCommand: command,
    });

    return responses;
  });
  // Chain onto the queue — swallow rejections so a failed command
  // doesn't block subsequent commands from executing.
  session.commandQueue = task.then(() => { }, () => { });
  return task;
}

/**
 * Dispatch an Agda control command (`Cmd_abort` / `Cmd_exit`) using
 * the three-step interruption pattern:
 *
 *   1. Synchronously reject the in-flight transport `sendCommand`
 *      (if any) with a `ControlCommandInterruption` so the IOTCM
 *      that was already written to Agda's stdin stops waiting on
 *      its per-command timeout. This is the protocol-level intent
 *      of `Cmd_abort` / `Cmd_exit`. The boolean return is captured
 *      *here* (not inside the transport) because by the time the
 *      queued fire-and-forget task runs, the listener has long
 *      since been removed and the check would always come back
 *      false — defeating the escalation gating.
 *
 *   2. Sweep already-queued regular work via `cancelledThrough`.
 *      Any `dispatchSessionCommand` task whose captured serial is
 *      `<=` the value we set will reject at task-body entry instead
 *      of running. Without this, a wedged Agda would let regular
 *      commands sit on the queue forever, starving the abort/exit
 *      behind them.
 *
 *   3. Chain the fire-and-forget write itself through `commandQueue`
 *      with `armEscalation` decided by `kind` + `wasInterrupting`:
 *
 *        * `"exit"` always arms — `Cmd_exit` is supposed to bring
 *          the proc down whether or not anything was in flight, and
 *          a wedged Agda that ignores it must still be reaped.
 *
 *        * `"abort"` arms only when we actually interrupted an
 *          in-flight command. An idle `Cmd_abort` is a protocol
 *          no-op; SIGTERMing the proc would kill a healthy session.
 */
export function dispatchSessionControlCommand(
  session: AgdaSession,
  agdaCmd: string,
  kind: "abort" | "exit",
): Promise<AgdaResponse[]> {
  // Step 1: synchronous interrupt of in-flight regular command.
  // The boolean return must be observed BEFORE we yield to
  // microtasks; once the in-flight's onError fires, the listener
  // is gone and a transport-side recheck always reports false.
  const wasInterrupting = session.transport.rejectInFlightCommand(
    "Interrupted by Agda control command",
    { controlCommand: true },
  );

  // Step 2: sweep already-queued regular work so the control
  // command isn't starved behind a backlog.
  session.cancelledThrough = session.commandSerial;

  // Step 3: escalation gating decided here, not inside the
  // transport — see the function docstring for the rationale.
  const armEscalation = kind === "exit" || wasInterrupting;

  const task = session.commandQueue.then(async () => {
    assertSessionAlive(session);
    const proc = session.ensureProcess();
    return session.transport.sendFireAndForgetCommand(
      proc,
      iotcmEnvelope(session.currentFile ?? "", agdaCmd),
      { armEscalation },
    );
  });
  session.commandQueue = task.then(() => { }, () => { });
  return task;
}
