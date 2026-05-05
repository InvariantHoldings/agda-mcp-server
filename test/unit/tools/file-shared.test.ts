// MIT License — see LICENSE
//
// Unit tests for the shared helpers under src/tools/file/. The walk-
// tolerance behavior of `resolveExistingChildWithinRoot` is the
// safety contract every directory-walking tool relies on
// (`agda_list_modules`, `agda_search_definitions`) — pin it here so
// a regression that re-introduces a crash on broken symlinks /
// permission errors fails this suite rather than aborting a real
// user's listing.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveExistingChildWithinRoot } from "../../../src/tools/file/shared.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-shared-test-"));
});

afterEach(() => {
  // Re-enable read perms so the cleanup can rmSync directories that
  // a test deliberately set to 000 below.
  try { chmodSync(root, 0o755); } catch { /* ignore */ }
  rmSync(root, { recursive: true, force: true });
});

describe("resolveExistingChildWithinRoot", () => {
  test("returns the canonical path for an in-root real file", () => {
    const target = join(root, "M.agda");
    writeFileSync(target, "module M where\n");

    const resolved = resolveExistingChildWithinRoot(root, target);
    expect(resolved).not.toBeNull();
    expect(resolved!.endsWith("M.agda")).toBeTruthy();
  });

  test("returns null for a broken symlink (target missing)", () => {
    const link = join(root, "broken.agda");
    symlinkSync(join(root, "does-not-exist.agda"), link);

    // Broken symlink: realpath fails with ENOENT. The walker must
    // skip rather than crash.
    expect(resolveExistingChildWithinRoot(root, link)).toBeNull();
  });

  test("returns null for a path that disappeared between readdir and realpath (TOCTOU)", () => {
    const phantom = join(root, "ghost.agda");
    // Never created — simulates the race where readdir saw it but
    // realpath gets ENOENT.
    expect(resolveExistingChildWithinRoot(root, phantom)).toBeNull();
  });

  test("returns null for a symlink that escapes the project root", () => {
    const link = join(root, "escape.agda");
    symlinkSync("/etc/hosts", link);

    // PathSandboxError: the sandbox check refuses entries that
    // resolve outside the root. The walker must skip these.
    expect(resolveExistingChildWithinRoot(root, link)).toBeNull();
  });
});
