// MIT License — see LICENSE
//
// Spawn-and-wire helper for `AgdaSession.ensureProcess`. Owns the
// concrete `spawn(...)` invocation and the stdout/stderr/close/error
// event hookup so `session.ts` doesn't have to know about
// `AgdaTransport`'s wire format. Pulled out so both pieces of the
// session lifecycle (process startup, session-state reset on close)
// stay readable.

import { spawn, type ChildProcess } from "node:child_process";

import { findAgdaBinary } from "./binary-discovery.js";
import { createLibraryRegistration, type LibraryRegistration } from "./library-registration.js";
import type { AgdaTransport } from "../session/agda-transport.js";

/**
 * Memoised library registration — `createLibraryRegistration` writes
 * a temp `AGDA_DIR` workspace, so we cache the registration per
 * session and clean it up on `destroy()`. Returns the existing
 * registration if one exists, otherwise creates a new one.
 */
export function ensureLibraryRegistration(args: {
  current: LibraryRegistration | null;
  repoRoot: string;
}): LibraryRegistration {
  if (args.current) return args.current;
  return createLibraryRegistration(args.repoRoot);
}

/**
 * Handle returned by `spawnAgdaProcess`. `detachListeners` removes
 * the transport/error wiring we installed at spawn time so that a
 * dying-but-not-yet-closed process can be abandoned without its
 * late stdout/stderr/close events firing into the (shared) transport
 * and corrupting the next command's state.
 */
export interface SpawnedAgdaProcess {
  proc: ChildProcess;
  detachListeners(): void;
}

/** Grace period (ms) between SIGTERM and the SIGKILL fallback. */
export const DEFAULT_TERMINATE_GRACE_MS = 3_000;

/** SIGTERM the proc, then SIGKILL after `graceMs` if it hasn't exited.
 *  Idempotent on already-exited or already-killed handles. The
 *  escalation timer is `unref()`'d so it doesn't keep Node alive. */
export function terminateAgdaProcess(
  proc: ChildProcess,
  options: { graceMs?: number } = {},
): void {
  if (procAlreadyExited(proc)) return;

  if (!proc.killed) {
    try {
      proc.kill("SIGTERM");
    } catch {
      return; // ESRCH: process gone between the check and the syscall
    }
  }

  const escalation = setTimeout(() => {
    if (!procAlreadyExited(proc)) {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }, options.graceMs ?? DEFAULT_TERMINATE_GRACE_MS);
  escalation.unref();
  proc.once("close", () => clearTimeout(escalation));
}

function procAlreadyExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Spawn a fresh `agda --interaction-json` subprocess for `repoRoot`
 * and wire its stdout/stderr to `transport`. Calls `onClose` and
 * `onError` so the session can reset its own state without exposing
 * internal fields to this module.
 *
 * Returns the spawned process together with a `detachListeners`
 * function. The caller MUST call `detachListeners` before
 * abandoning the process (e.g. when respawning after a timeout)
 * so that late events from the dying process cannot reach the
 * shared transport, which by then is mid-command for the new
 * process.
 */
export function spawnAgdaProcess(args: {
  repoRoot: string;
  registration: LibraryRegistration;
  transport: AgdaTransport;
  onClose: () => void;
  onError: (err: Error) => void;
}): SpawnedAgdaProcess {
  const agdaBin = findAgdaBinary(args.repoRoot);
  const proc = spawn(agdaBin, ["--interaction-json", ...args.registration.agdaArgs], {
    cwd: args.repoRoot,
    env: { ...process.env, AGDA_DIR: args.registration.agdaDir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const onStdout = (chunk: Buffer): void => {
    args.transport.handleStdout(chunk);
  };
  const onStderr = (chunk: Buffer): void => {
    args.transport.handleStderr(chunk);
  };
  const onClose = (): void => {
    args.transport.handleProcessClose();
    args.onClose();
  };
  const onError = (err: Error): void => {
    args.transport.handleProcessError(err);
    args.onError(err);
  };

  proc.stdout?.on("data", onStdout);
  proc.stderr?.on("data", onStderr);
  proc.on("close", onClose);
  proc.on("error", onError);

  const detachListeners = (): void => {
    proc.stdout?.off("data", onStdout);
    proc.stderr?.off("data", onStderr);
    proc.off("close", onClose);
    proc.off("error", onError);
  };

  return { proc, detachListeners };
}
