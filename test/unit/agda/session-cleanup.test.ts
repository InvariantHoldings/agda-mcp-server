// MIT License — see LICENSE
//
// Unit tests for AgdaSession's process-close cleanup contract. The
// session creates a per-process AGDA_DIR via mkdtempSync as part of
// `ensureLibraryRegistration` (see src/agda/library-registration.ts).
// If the Agda subprocess crashes (close event fires without an
// explicit destroy() call from the host), that temp directory must
// be released — otherwise a long-running MCP server accumulates
// orphan AGDA_DIR/* trees in os.tmpdir() forever.

import { describe, test, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import { AgdaSession } from "../../../src/agda/session.js";

describe("AgdaSession: process-close cleanup", () => {
  test("handleProcessClose releases libraryRegistration so a crash doesn't leak the temp AGDA_DIR", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);

      // Inject a stub registration whose cleanup() flips a flag and
      // removes a sentinel directory. The session never spawns a
      // real Agda process for this test — we drive the lifecycle
      // hooks by hand.
      const sentinel = mkdtempSync(join(tmpdir(), "agda-mcp-leak-sentinel-"));
      writeFileSync(join(sentinel, "marker"), "I should be cleaned up");
      let cleanupCalls = 0;
      const stubRegistration = {
        agdaArgs: [],
        agdaDir: sentinel,
        cleanup() {
          cleanupCalls += 1;
          rmSync(sentinel, { recursive: true, force: true });
        },
      };

      // Reach into the private field to install the stub. This is
      // the same shape the real `ensureLibraryRegistration` returns
      // and is the field `handleProcessClose` is responsible for.
      (session as unknown as { libraryRegistration: typeof stubRegistration | null }).libraryRegistration =
        stubRegistration;

      // Drive the close handler — same path the real spawn callback
      // takes when Agda exits abnormally.
      (session as unknown as { handleProcessClose(): void }).handleProcessClose();

      expect(cleanupCalls).toBe(1);
      expect(existsSync(sentinel)).toBe(false);
      // After cleanup, the field is nulled so a re-spawn picks up
      // a fresh registration via `ensureLibraryRegistration`.
      expect(
        (session as unknown as { libraryRegistration: unknown }).libraryRegistration,
      ).toBeNull();

      // destroy() must remain idempotent on a session whose
      // libraryRegistration was already released by the close
      // handler.
      session.destroy();
      expect(cleanupCalls).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("handleProcessClose ignores callbacks from an already-replaced process", () => {
    // Regression for the 0.6.7 resource-leak fix: when sendCommand
    // times out and ensureProcess respawns over the killed proc, the
    // old subprocess's `close` event may still fire afterwards
    // (kernels deliver SIGTERM-driven exits asynchronously). Without
    // an identity guard, that late callback would null out the
    // *new* process's libraryRegistration and currentFile mid-command.
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);

      const liveSentinel = mkdtempSync(join(tmpdir(), "agda-mcp-live-sentinel-"));
      let cleanupCalls = 0;
      const stubRegistration = {
        agdaArgs: [],
        agdaDir: liveSentinel,
        cleanup() {
          cleanupCalls += 1;
          rmSync(liveSentinel, { recursive: true, force: true });
        },
      };

      // Pretend we just spawned a *new* process — `currentProc` —
      // and an OLDER process's close event is still in flight.
      const currentProc = { pid: 1000 } as unknown as ChildProcess;
      const olderProc = { pid: 999 } as unknown as ChildProcess;

      const sessionAny = session as unknown as {
        proc: ChildProcess | null;
        libraryRegistration: typeof stubRegistration | null;
        currentFile: string | null;
        handleProcessClose(proc: ChildProcess): void;
      };
      sessionAny.proc = currentProc;
      sessionAny.libraryRegistration = stubRegistration;
      sessionAny.currentFile = "/tmp/Live.agda";

      // The stale close event arrives. handleProcessClose must
      // recognise it as belonging to a replaced process and bail
      // before touching live state.
      sessionAny.handleProcessClose(olderProc);

      expect(cleanupCalls).toBe(0);
      expect(sessionAny.proc).toBe(currentProc);
      expect(sessionAny.libraryRegistration).toBe(stubRegistration);
      expect(sessionAny.currentFile).toBe("/tmp/Live.agda");
      expect(existsSync(liveSentinel)).toBe(true);

      // Now the *current* process closes — state should reset.
      sessionAny.handleProcessClose(currentProc);
      expect(cleanupCalls).toBe(1);
      expect(sessionAny.proc).toBeNull();
      expect(sessionAny.libraryRegistration).toBeNull();
      expect(sessionAny.currentFile).toBeNull();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("destroy detaches listeners and uses SIGTERM→SIGKILL termination on a wedged proc", () => {
    // Regression for the 0.6.7 fix: pre-fix, `destroy()` did
    // `proc.kill()` with no SIGKILL fallback and no listener
    // detach. A wedged Agda subprocess that ignored SIGTERM would
    // survive the MCP server's own shutdown, and any late events
    // from the doomed child could still fire into the (now nulled)
    // session.
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);

      const killSignals: Array<NodeJS.Signals | number | undefined> = [];
      let detachCalls = 0;
      const fakeProc = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        killed: false,
        kill(signal?: NodeJS.Signals | number) {
          killSignals.push(signal);
          this.killed = true;
          return true;
        },
        once(_event: string, _listener: (...args: unknown[]) => void) {
          return this as unknown as ChildProcess;
        },
      };

      const sentinel = mkdtempSync(join(tmpdir(), "agda-mcp-destroy-listener-"));
      const stubRegistration = {
        agdaArgs: [],
        agdaDir: sentinel,
        cleanup() {
          rmSync(sentinel, { recursive: true, force: true });
        },
      };

      const sessionAny = session as unknown as {
        proc: ChildProcess | null;
        libraryRegistration: typeof stubRegistration | null;
        detachProcListeners: (() => void) | null;
      };
      sessionAny.proc = fakeProc as unknown as ChildProcess;
      sessionAny.libraryRegistration = stubRegistration;
      sessionAny.detachProcListeners = () => { detachCalls += 1; };

      session.destroy();

      // SIGTERM must have been delivered, the listener detacher must
      // have run, and both fields must be nulled to prevent the
      // SIGKILL escalation timer (which `terminateAgdaProcess`
      // scheduled with unref()) from touching them later.
      expect(killSignals[0]).toBe("SIGTERM");
      expect(detachCalls).toBe(1);
      expect(sessionAny.proc).toBeNull();
      expect(sessionAny.detachProcListeners).toBeNull();
      expect(sessionAny.libraryRegistration).toBeNull();
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("destroy releases libraryRegistration when no prior close fired", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);
      const sentinel = mkdtempSync(join(tmpdir(), "agda-mcp-destroy-sentinel-"));
      let cleanupCalls = 0;
      const stubRegistration = {
        agdaArgs: [],
        agdaDir: sentinel,
        cleanup() {
          cleanupCalls += 1;
          rmSync(sentinel, { recursive: true, force: true });
        },
      };
      (session as unknown as { libraryRegistration: typeof stubRegistration | null }).libraryRegistration =
        stubRegistration;

      session.destroy();

      expect(cleanupCalls).toBe(1);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
