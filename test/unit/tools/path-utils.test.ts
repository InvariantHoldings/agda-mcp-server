// MIT License — see LICENSE
//
// Pin the `canonicalizeOrFallback` contract: a real path resolves
// to its canonical form (handles macOS /var → /private/var symlink),
// and a non-existent path returns the input unchanged instead of
// throwing.

import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalizeOrFallback,
  resolveProjectFile,
} from "../../../src/tools/path-utils.js";

test("returns the input unchanged when path doesn't exist", () => {
  const fake = "/this/path/should/not/exist/anywhere";
  expect(canonicalizeOrFallback(fake)).toBe(fake);
});

test("resolves a real directory to itself when there are no symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-canon-"));
  try {
    const result = canonicalizeOrFallback(dir);
    // mkdtemp on macOS returns a path under /var, which realpathSync
    // canonicalises to /private/var. Either accept exactly the input
    // or accept the /private/var-prefixed canonical form — both are
    // the contract this helper offers.
    expect(result === dir || result === `/private${dir}`).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("follows a symlink to its target", () => {
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-canon-"));
  try {
    const target = join(root, "real");
    const link = join(root, "via-symlink");
    mkdirSync(target);
    symlinkSync(target, link);

    const result = canonicalizeOrFallback(link);
    // Compare on the macOS-canonical form so /private/var/... wins
    // over /var/... if the test temp dir lives there.
    const targetCanonical = canonicalizeOrFallback(target);
    expect(result).toBe(targetCanonical);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── resolveProjectFile ───────────────────────────────────────────────

test("resolveProjectFile returns filePath for an existing file inside the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-resolve-"));
  try {
    const filePath = join(root, "Foo.agda");
    writeFileSync(filePath, "module Foo where\n");
    const result = resolveProjectFile(root, "Foo.agda");
    expect(result.error).toBeUndefined();
    // The canonical path resolves through any platform symlinks
    // (e.g. macOS /var → /private/var), so compare via realpath.
    expect(result.filePath).toBe(canonicalizeOrFallback(filePath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectFile reports invalid-path on a sandbox escape", () => {
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-resolve-"));
  try {
    const result = resolveProjectFile(root, "../../../etc/passwd");
    expect(result.filePath).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.classification).toBe("invalid-path");
    expect(result.error!.message).toContain("Invalid file path");
    expect(result.error!.nextAction).toMatch(/PROJECT_ROOT/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectFile reports not-found for a missing file inside the root", () => {
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-resolve-"));
  try {
    const result = resolveProjectFile(root, "DoesNotExist.agda");
    expect(result.filePath).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.classification).toBe("not-found");
    expect(result.error!.message).toContain("File not found");
    expect(result.error!.nextAction).toMatch(/agda_file_list|agda_search/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectFile carries an actionable nextAction on every error", () => {
  // Pin: any error returned by the helper carries a non-empty
  // nextAction. The migration to use this helper across tools relies
  // on this — without it tools would emit `nextAction: undefined` and
  // the `nextAction-on-every-error` invariant would silently break.
  const root = mkdtempSync(join(tmpdir(), "agda-mcp-resolve-"));
  try {
    for (const badPath of ["../escape", "DoesNotExist"]) {
      const r = resolveProjectFile(root, badPath);
      expect(r.error).toBeDefined();
      expect(r.error!.nextAction.length).toBeGreaterThan(20);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
