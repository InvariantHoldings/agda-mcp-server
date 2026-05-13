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
 *   2. `signalCode === null` — proc was not terminated by a signal.
 *      Critical because Node leaves `exitCode === null` when a child
 *      dies from a signal and instead populates `signalCode`; without
 *      this check, a child killed externally (so `.killed` is also
 *      false) but not yet reaped via the `close` event would be
 *      reported as live. See Copilot review comment on PR #56.
 *   3. `!proc.killed` — we did not just send it SIGTERM ourselves
 *      (e.g. from the per-command timeout in `AgdaTransport`).
 */
export function isProcLive(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null && !proc.killed;
}

/**
 * Start the Agda process if not already running, or replace the
 * current one if it has died or been killed.
 *
 * `proc.killed` is checked alongside `exitCode` because a process
 * we just sent SIGTERM to (e.g. from `AgdaTransport.sendCommand`'s
 * timeout handler) has `exitCode === null` until the kernel
 * actually reaps it. Without the `.killed` guard we'd hand back a
 * dying handle and pile the next command onto a zombie — the
 * exact leak 0.6.7 fixes.
 *
 * When the previous handle is being abandoned we MUST detach its
 * listeners *before* the new proc is wired up, otherwise a late
 * `close` event from the dying child would reach the shared
 * transport mid-command for the replacement process and falsely
 * emit `done`.
 */
export function ensureProcessForSession(session: AgdaSession): ChildProcess {
  if (session.proc && isProcLive(session.proc)) {
    return session.proc;
  }

  if (session.proc) {
    session.detachProcListeners?.();
    session.detachProcListeners = null;
    terminateAgdaProcess(session.proc);
    session.proc = null;
  }

  // The close handler that would normally release the old AGDA_DIR
  // registration is now detached, so free it explicitly before
  // allocating a fresh one. Without this, the old registration's
  // mkdtemp'd directory leaks every time we respawn.
  if (session.libraryRegistration) {
    session.libraryRegistration.cleanup();
    session.libraryRegistration = null;
  }

  // Process died, was killed, or never started — reset every
  // field that depends on the live Agda process. This mirrors
  // `handleSessionProcessClose` but runs synchronously so the
  // freshly spawned process below starts from a clean slate.
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
  session.detectedVersion = null;
  session.versionDetectionAttempts = 0;
  session.exiting = false;

  session.libraryRegistration = ensureLibraryRegistration({
    current: null,
    repoRoot: session.repoRoot,
  });

  const spawned = adoptSpawnedProcessForSession(
    session,
    spawnAgdaProcess({
      repoRoot: session.repoRoot,
      registration: session.libraryRegistration,
      transport: session.transport,
      onClose: () => handleSessionProcessClose(session, spawned.proc),
      onError: () => { /* transport already logged */ },
    }),
  );

  return spawned.proc;
}

/**
 * Take ownership of a freshly-spawned process handle plus its
 * listener detacher. Keeping the two in sync is critical: every
 * assignment of `session.proc` MUST go through here so that
 * `detachProcListeners` always refers to *that* process's wiring,
 * never an older one's.
 */
export function adoptSpawnedProcessForSession(
  session: AgdaSession,
  spawned: SpawnedAgdaProcess,
): SpawnedAgdaProcess {
  session.proc = spawned.proc;
  session.detachProcListeners = spawned.detachListeners;
  return spawned;
}

/**
 * Reset every field that depends on the live Agda process. Called
 * from the spawn helper's `close` callback. Accepts the closing
 * process so we can ignore late-firing `close` events from a
 * process that was already replaced — without this guard a slow
 * SIGTERM on the *previous* process could nuke the *current*
 * process's registration and `currentFile` mid-command.
 */
export function handleSessionProcessClose(
  session: AgdaSession,
  closingProc: ChildProcess,
): void {
  if (session.proc !== null && session.proc !== closingProc) {
    // The session already moved on to a new process (likely via
    // ensureProcess() after a timeout-driven kill). Treat this
    // event as belonging to the abandoned process and ignore it —
    // ensureProcess already detached the listeners, but a buffered
    // event scheduled before detach can still arrive on this turn.
    return;
  }
  session.proc = null;
  session.detachProcListeners = null;
  // Release the per-session AGDA_DIR temp directory eagerly. If
  // Agda crashed (process exit without an explicit destroy() from
  // the host), the registration would otherwise leak its
  // `mkdtempSync` directory until the OS cleans `os.tmpdir()` —
  // which on long-running servers is "never". A re-spawn via
  // ensureProcess will create a fresh registration for the new
  // process; the old one is no longer reachable.
  session.libraryRegistration?.cleanup();
  session.libraryRegistration = null;
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
  session.exiting = false;
  // Reset version detection so the next process start re-detects cleanly.
  session.detectedVersion = null;
  session.versionDetectionAttempts = 0;
}

/**
 * Tear down the proc handle and clear all process-bound state.
 * Returns a Promise that resolves once the subprocess has actually
 * exited (or once a hard fallback timeout fires, in case the kernel
 * never delivers `close`). Synchronous state cleanup happens before
 * the await, so callers that don't await still see fully reset
 * state — they just won't observe the SIGKILL escalation.
 *
 * Callers in shutdown paths (signal handlers in `src/index.ts`)
 * MUST await this Promise before calling `process.exit()`,
 * otherwise Node tears down before the unref'd escalation timer
 * inside `terminateAgdaProcess` can fire and a SIGTERM-ignoring
 * child survives shutdown.
 */
export function destroySessionProcess(session: AgdaSession): Promise<void> {
  // Flip the destroyed flag FIRST so any task already chained onto
  // `commandQueue` (queued before destroy ran) observes it and
  // bails before calling `ensureProcess()`. Without this guard, a
  // queued sendCommand could spawn a fresh Agda right as shutdown
  // is awaiting the previous proc's exit.
  session.destroyed = true;
  const proc = session.proc;
  if (proc) {
    session.detachProcListeners?.();
    session.detachProcListeners = null;
    session.proc = null;
  }
  session.libraryRegistration?.cleanup();
  session.libraryRegistration = null;
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
  session.detectedVersion = null;
  session.versionDetectionAttempts = 0;
  session.transport.destroy();
  session.commandQueue = Promise.resolve();
  session.exiting = false;

  if (!proc) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const onClose = (): void => {
      clearTimeout(hardTimeout);
      resolve();
    };
    proc.once("close", onClose);
    // Hard fallback in case `close` never fires (kernel weirdness,
    // a grandchild keeping the pipe open, etc.). Slightly longer
    // than `terminateAgdaProcess`'s SIGKILL grace so the escalation
    // gets a real chance to land before we give up.
    const hardTimeout: NodeJS.Timeout = setTimeout(() => {
      proc.off("close", onClose);
      resolve();
    }, DEFAULT_TERMINATE_GRACE_MS + 1_000);
    terminateAgdaProcess(proc);
  });
}
