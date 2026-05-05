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
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
