import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

/**
 * The canonicalize() helper in register-agda-apply-edit.ts uses
 * realpathSync to compare session.currentFile against the edit
 * target, so a plain string compare (which fails under symlinks,
 * `..` segments, or trailing slashes) doesn't cause us to miss the
 * "is this the loaded file?" check. These tests pin the invariants
 * that the helper relies on.
 */
describe("path canonicalization invariants", () => {
  let tempDir: string;
  let targetFile: string;
  let symlinkPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-canon-test-"));
    targetFile = join(tempDir, "Real.agda");
    symlinkPath = join(tempDir, "Link.agda");
    await writeFile(targetFile, "test = {!!}\n");
    await symlink(targetFile, symlinkPath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("realpathSync resolves a symlink and its target to the same path", () => {
    expect(realpathSync(symlinkPath)).toBe(realpathSync(targetFile));
  });

  test("realpathSync normalizes .. segments", () => {
    const viaParent = join(dirname(targetFile), "..", basename(tempDir), "Real.agda");
    expect(realpathSync(viaParent)).toBe(realpathSync(targetFile));
  });

  test("realpathSync normalizes trailing slashes on directory prefixes", () => {
    const withSlash = join(`${tempDir}${"/"}`, "Real.agda");
    expect(realpathSync(withSlash)).toBe(realpathSync(targetFile));
  });
});
