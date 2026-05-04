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
 * Spawn a fresh `agda --interaction-json` subprocess for `repoRoot`
 * and wire its stdout/stderr to `transport`. Calls `onClose` and
 * `onError` so the session can reset its own state without exposing
 * internal fields to this module.
 *
 * Returns the spawned `ChildProcess`. Caller is responsible for
 * remembering the handle and calling `kill()` at destroy time.
 */
export function spawnAgdaProcess(args: {
  repoRoot: string;
  registration: LibraryRegistration;
  transport: AgdaTransport;
  onClose: () => void;
  onError: (err: Error) => void;
}): ChildProcess {
  const agdaBin = findAgdaBinary(args.repoRoot);
  const proc = spawn(agdaBin, ["--interaction-json", ...args.registration.agdaArgs], {
    cwd: args.repoRoot,
    env: { ...process.env, AGDA_DIR: args.registration.agdaDir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    args.transport.handleStdout(chunk);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    args.transport.handleStderr(chunk);
  });

  proc.on("close", () => {
    args.transport.handleProcessClose();
    args.onClose();
  });

  proc.on("error", (err) => {
    args.transport.handleProcessError(err);
    args.onError(err);
  });

  return proc;
}
