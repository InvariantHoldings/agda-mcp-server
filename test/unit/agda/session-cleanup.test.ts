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
import { handleSessionProcessClose } from "../../../src/agda/session-process-lifecycle.js";

describe("AgdaSession: process-close cleanup", () => {
  test("handleProcessClose releases libraryRegistration so a crash doesn't leak the temp AGDA_DIR", async () => {
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

      // Reach into the (now module-internal) field to install the
      // stub. This is the same shape the real `ensureLibraryRegistration`
      // returns and is the field `handleSessionProcessClose` is
      // responsible for.
      session.libraryRegistration = stubRegistration;

      // Drive the close handler — same path the real spawn callback
      // takes when Agda exits abnormally. Pass a sentinel proc;
      // `session.proc` is null in this synthetic setup so the
      // identity guard treats this as a primary-close event.
      handleSessionProcessClose(session, { pid: 12345 } as unknown as ChildProcess);

      expect(cleanupCalls).toBe(1);
      expect(existsSync(sentinel)).toBe(false);
      // After cleanup, the field is nulled so a re-spawn picks up
      // a fresh registration via `ensureLibraryRegistration`.
      expect(session.libraryRegistration).toBeNull();

      // destroy() must remain idempotent on a session whose
      // libraryRegistration was already released by the close
      // handler.
      await session.destroy();
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

      session.proc = currentProc;
      session.libraryRegistration = stubRegistration;
      session.currentFile = "/tmp/Live.agda";

      // The stale close event arrives. handleSessionProcessClose
      // must recognise it as belonging to a replaced process and bail
      // before touching live state.
      handleSessionProcessClose(session, olderProc);

      expect(cleanupCalls).toBe(0);
      expect(session.proc).toBe(currentProc);
      expect(session.libraryRegistration).toBe(stubRegistration);
      expect(session.currentFile).toBe("/tmp/Live.agda");
      expect(existsSync(liveSentinel)).toBe(true);

      // Now the *current* process closes — state should reset.
      handleSessionProcessClose(session, currentProc);
      expect(cleanupCalls).toBe(1);
      expect(session.proc).toBeNull();
      expect(session.libraryRegistration).toBeNull();
      expect(session.currentFile).toBeNull();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("destroy detaches listeners and uses SIGTERM→SIGKILL termination on a wedged proc", async () => {
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
      // Synthesise a proc that emits `close` immediately when killed
      // so destroy()'s awaited Promise resolves promptly. Without
      // this we'd hit the destroy() hard-fallback timeout and the
      // test would take ~4s.
      const closeListeners: Array<() => void> = [];
      const fakeProc = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        killed: false,
        kill(signal?: NodeJS.Signals | number) {
          killSignals.push(signal);
          this.killed = true;
          this.exitCode = 143;
          // Synchronously fire close listeners — destroy() waits on
          // `proc.once("close", ...)` so this unblocks the await.
          for (const fn of closeListeners.splice(0)) fn();
          return true;
        },
        once(event: string, listener: () => void) {
          if (event === "close") closeListeners.push(listener);
          return this as unknown as ChildProcess;
        },
        off(_event: string, _listener: () => void) {
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

      session.proc = fakeProc as unknown as ChildProcess;
      session.libraryRegistration = stubRegistration;
      session.detachProcListeners = () => { detachCalls += 1; };

      await session.destroy();

      // SIGTERM must have been delivered, the listener detacher must
      // have run, and both fields must be nulled to prevent the
      // SIGKILL escalation timer (which `terminateAgdaProcess`
      // scheduled with unref()) from touching them later.
      expect(killSignals[0]).toBe("SIGTERM");
      expect(detachCalls).toBe(1);
      expect(session.proc).toBeNull();
      expect(session.detachProcListeners).toBeNull();
      expect(session.libraryRegistration).toBeNull();
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("concurrent destroy() calls share the in-flight teardown Promise", async () => {
    // A second SIGTERM during the first destroy()'s await must NOT
    // resolve immediately just because session.proc was already
    // nulled — both shutdown paths must observe the same termination.
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);

      let resolveClose: (() => void) | null = null;
      const closeListeners: Array<() => void> = [];
      const fakeProc = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        killed: false,
        kill() { this.killed = true; this.exitCode = 143; return true; },
        once(event: string, listener: () => void) {
          if (event === "close") closeListeners.push(listener);
          return this as unknown as ChildProcess;
        },
        off(_event: string, _listener: () => void) {
          return this as unknown as ChildProcess;
        },
      };
      session.proc = fakeProc as unknown as ChildProcess;
      session.detachProcListeners = () => { /* noop */ };
      resolveClose = () => closeListeners.splice(0).forEach((fn) => fn());

      const first = session.destroy();
      const second = session.destroy();

      // Both calls must return the same Promise — neither resolves
      // before the child actually closes.
      expect(second).toBe(first);

      let firstSettled = false;
      let secondSettled = false;
      void first.then(() => { firstSettled = true; });
      void second.then(() => { secondSettled = true; });
      await new Promise((r) => setTimeout(r, 10));
      expect(firstSettled).toBe(false);
      expect(secondSettled).toBe(false);

      resolveClose();
      await first;
      expect(firstSettled).toBe(true);
      expect(secondSettled).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("ensureProcess refuses to spawn after destroy()", async () => {
    // Without this guard, an external caller could call ensureProcess()
    // after destroy() and spawn a fresh Agda that sendCommand would
    // never use (since it now rejects on `destroyed`) — reintroducing
    // the leak via a side door.
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-session-test-"));
    try {
      const session = new AgdaSession(repoRoot);
      await session.destroy();
      expect(() => session.ensureProcess()).toThrow(/AgdaSession is destroyed/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("destroy releases libraryRegistration when no prior close fired", async () => {
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
      session.libraryRegistration = stubRegistration;

      await session.destroy();

      expect(cleanupCalls).toBe(1);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
