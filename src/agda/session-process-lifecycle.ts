// MIT License — see LICENSE
//
// Process-lifecycle helpers for `AgdaSession`. Extracted from
// `session.ts` so that file can stay under the 500-line ceiling
// declared in `ARCHITECTURE.md` ("Module-size convention"). The
// pattern mirrors `session-load-impl.ts`: free functions that take
// an `AgdaSession` reference and mutate its module-internal state.
// External consumers should keep using the class methods on
// `AgdaSession` — these helpers are an implementation detail of
// process spawn / respawn / close / shutdown.
//
// Why this is a separate module:
//   - Process lifecycle is its own concern (spawn, detach, kill,
//     respawn-on-stale, shutdown) and clusters cleanly.
//   - `session.ts` also owns the command queue, version detection
//     glue, IOTCM builders, the load orchestrator, and a dozen
//     accessors. Bundling lifecycle in keeps pushing the file over
//     the limit on every change.
//   - The fields these helpers mutate (`proc`, `detachProcListeners`,
//     `libraryRegistration`, etc.) are declared module-internal in
//     `session.ts` and read by no external consumer — moving the
//     mutations here doesn't change the public surface.

import type { ChildProcess } from "node:child_process";

import type { AgdaSession } from "./session.js";
import {
  DEFAULT_TERMINATE_GRACE_MS,
  ensureLibraryRegistration,
  spawnAgdaProcess,
  terminateAgdaProcess,
  type SpawnedAgdaProcess,
} from "./agda-process-spawn.js";

/**
 * Predicate for "this proc handle is still usable". Three guards:
 *
 *   1. `exitCode === null` — proc has not exited normally.
 *      Strict equality because a 0 exit code is falsy but means
 *      "exited cleanly" and must NOT count as live.
 *   2. `!proc.signalCode` — proc was not terminated by a signal.
 *      Critical because Node leaves `exitCode === null` when a child
 *      dies from a signal and instead populates `signalCode` with
 *      the signal name; without this check, a child killed externally
 *      (so `.killed` is also false) but not yet reaped via the
 *      `close` event would be reported as live. See Copilot review
 *      comment on PR #56. Falsy check rather than `=== null` so a
 *      fake proc whose `signalCode` is `undefined` is treated as
 *      "no signal received" — matches the intent.
 *   3. `!proc.killed` — we did not just send it SIGTERM ourselves
 *      (e.g. from the per-command timeout in `AgdaTransport`).
 */
export function isProcLive(proc: ChildProcess): boolean {
  return proc.exitCode === null && !proc.signalCode && !proc.killed;
}

const DESTROYED_SESSION_ERROR = "AgdaSession is destroyed; cannot send new commands";
const STALE_PREFLIGHT_ERROR =
  "Agda subprocess was replaced during version preflight; call agda_load before retrying.";

/** Throw if `session.destroy()` has been called. Used at both task
 *  entry and after the preflight `await`, since `preflightVersionDetection`
 *  swallows transport errors (so a `destroy()`-triggered preflight
 *  rejection wouldn't otherwise propagate). */
export function assertSessionAlive(session: AgdaSession): void {
  if (session.destroyed) {
    throw new Error(DESTROYED_SESSION_ERROR);
  }
}

/** Throw if the user's IOTCM envelope is stale. It became stale if
 *  preflight killed the process (so the original `currentFile`/goal
 *  IDs no longer map to a live Agda) or if `currentFile` itself was
 *  swapped concurrently. Either way the caller's pre-built command
 *  cannot be safely forwarded. */
export function assertProcSurvivedPreflight(
  session: AgdaSession,
  proc: ChildProcess,
  fileAtStart: string | null,
): void {
  if (!isProcLive(proc) || fileAtStart !== session.currentFile) {
    throw new Error(STALE_PREFLIGHT_ERROR);
  }
}

/** Reset every field that depends on a live Agda process. Called
 *  from the `finally` branch of `sendCommand` so a follow-up tool
 *  sees a clean "No file loaded" surface instead of building a
 *  stale IOTCM envelope against a dead process. */
export function resetFileBoundStateIfProcDied(
  session: AgdaSession,
  proc: ChildProcess,
): void {
  if (isProcLive(proc)) return;
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
}

/** Start the Agda process if not already running, or replace the
 *  current one if it has died, was killed, or was signaled. */
export function ensureProcessForSession(session: AgdaSession): ChildProcess {
  if (session.destroyed) {
    throw new Error("AgdaSession is destroyed; cannot ensureProcess");
  }

  if (session.proc && isProcLive(session.proc)) {
    return session.proc;
  }

  if (session.proc) {
    detachAndTerminate(session, session.proc);
    session.proc = null;
  }

  freeLibraryRegistration(session);
  resetProcBoundState(session);

  session.libraryRegistration = ensureLibraryRegistration({
    current: null,
    repoRoot: session.repoRoot,
  });

  // The `onClose` callback receives the spawned proc handle as an
  // argument (rather than closing over the enclosing `spawned`
  // declaration) so this initializer is not self-referential — the
  // previous shape was flagged by strict TypeScript as a
  // use-before-initialization pattern and would have been fragile
  // if `spawnAgdaProcess` ever invoked the callback synchronously.
  const spawned = spawnAgdaProcess({
    repoRoot: session.repoRoot,
    registration: session.libraryRegistration,
    transport: session.transport,
    onClose: (closingProc) => handleSessionProcessClose(session, closingProc),
    onError: () => { /* transport already logged */ },
  });
  adoptSpawnedProcessForSession(session, spawned);

  return spawned.proc;
}

/** Adopt a freshly-spawned proc and its listener detacher in lockstep.
 *  Every assignment to `session.proc` MUST flow through here so the
 *  detacher always refers to the current process, never an older one. */
export function adoptSpawnedProcessForSession(
  session: AgdaSession,
  spawned: SpawnedAgdaProcess,
): SpawnedAgdaProcess {
  session.proc = spawned.proc;
  session.detachProcListeners = spawned.detachListeners;
  return spawned;
}

/** Reset session state when the Agda process closes. The identity
 *  guard ignores `close` events from a process the session already
 *  replaced — without it, a slow SIGTERM on the previous process
 *  would nuke the *current* process's state mid-command. */
export function handleSessionProcessClose(
  session: AgdaSession,
  closingProc: ChildProcess,
): void {
  if (session.proc !== null && session.proc !== closingProc) return;
  session.proc = null;
  session.detachProcListeners = null;
  freeLibraryRegistration(session);
  resetProcBoundState(session);
}

/** Tear down the proc handle and clear all process-bound state.
 *
 *  Returns the SAME Promise on every call (re-entrant) so a second
 *  concurrent `destroy()` — e.g. a second SIGTERM during the first
 *  teardown — attaches to the in-flight termination instead of
 *  resolving immediately after `proc` was nulled. Synchronous state
 *  reset happens on the first call so fire-and-forget callers still
 *  see clean state right away.
 *
 *  Callers in shutdown paths MUST `await` this Promise before
 *  `process.exit()`: the SIGKILL escalation inside
 *  `terminateAgdaProcess` runs from an `unref()`'d timer, so a sync
 *  exit truncates it and a SIGTERM-ignoring child can survive. */
export function destroySessionProcess(session: AgdaSession): Promise<void> {
  if (session.teardownPromise) {
    return session.teardownPromise;
  }
  session.destroyed = true;

  const proc = session.proc;
  if (proc) {
    session.detachProcListeners?.();
    session.detachProcListeners = null;
    session.proc = null;
  }
  freeLibraryRegistration(session);
  resetProcBoundState(session);
  session.transport.destroy();
  session.commandQueue = Promise.resolve();

  session.teardownPromise = proc
    ? waitForProcExit(proc, DEFAULT_TERMINATE_GRACE_MS + 1_000)
    : Promise.resolve();
  return session.teardownPromise;
}

function waitForProcExit(proc: ChildProcess, hardTimeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const onClose = (): void => {
      clearTimeout(hardTimeout);
      resolve();
    };
    proc.once("close", onClose);
    const hardTimeout: NodeJS.Timeout = setTimeout(() => {
      proc.off("close", onClose);
      resolve();
    }, hardTimeoutMs);
    terminateAgdaProcess(proc);
  });
}

function detachAndTerminate(session: AgdaSession, proc: ChildProcess): void {
  session.detachProcListeners?.();
  session.detachProcListeners = null;
  terminateAgdaProcess(proc);
}

function freeLibraryRegistration(session: AgdaSession): void {
  session.libraryRegistration?.cleanup();
  session.libraryRegistration = null;
}

/** Reset every field that depends on a live Agda process. Used by
 *  both `ensureProcessForSession` (before respawn) and `destroySessionProcess`
 *  (final teardown) so the two paths can't drift on what counts as
 *  "process-bound state". */
function resetProcBoundState(session: AgdaSession): void {
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
  session.detectedVersion = null;
  session.versionDetectionAttempts = 0;
  session.exiting = false;
}
