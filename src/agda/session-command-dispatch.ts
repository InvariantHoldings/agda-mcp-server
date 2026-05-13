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
): Promise<AgdaResponse[]> {
  const task = session.commandQueue.then(async () => {
    assertSessionAlive(session);

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

      responses = await session.transport.sendCommand(proc, command, timeoutMs);
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
 * the two-step interruption pattern:
 *
 *   1. Synchronously reject the in-flight transport `sendCommand`
 *      (if any) with a `ControlCommandInterruption` so the IOTCM
 *      that was already written to Agda's stdin stops waiting on
 *      its per-command timeout. This is the protocol-level intent
 *      of `Cmd_abort` / `Cmd_exit`.
 *
 *   2. Chain the fire-and-forget write itself through
 *      `commandQueue`. The flush window inside
 *      `sendFireAndForgetCommand` mutates shared transport state
 *      (`collecting`, idle timer); routing it through the queue
 *      guarantees no subsequent `sendCommand` starts until the
 *      flush has resolved, so a queued regular command cannot have
 *      its `collecting=true` flipped back to false mid-flight by a
 *      late flush timer from the control command.
 */
export function dispatchSessionControlCommand(
  session: AgdaSession,
  agdaCmd: string,
): Promise<AgdaResponse[]> {
  session.transport.rejectInFlightCommand(
    "Interrupted by Agda control command",
    { controlCommand: true },
  );

  const task = session.commandQueue.then(async () => {
    assertSessionAlive(session);
    const proc = session.ensureProcess();
    return session.transport.sendFireAndForgetCommand(
      proc,
      iotcmEnvelope(session.currentFile ?? "", agdaCmd),
    );
  });
  session.commandQueue = task.then(() => { }, () => { });
  return task;
}
