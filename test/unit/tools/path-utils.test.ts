// MIT License — see LICENSE
//
// Pin the `canonicalizeOrFallback` contract: a real path resolves
// to its canonical form (handles macOS /var → /private/var symlink),
// and a non-existent path returns the input unchanged instead of
// throwing.

import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalizeOrFallback } from "../../../src/tools/path-utils.js";

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
