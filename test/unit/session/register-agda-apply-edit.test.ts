import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

import {
  AGDA_SOURCE_EXTENSIONS,
  hasAgdaSourceExtension,
} from "../../../src/session/register-agda-apply-edit.js";

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

describe("hasAgdaSourceExtension (extension allowlist)", () => {
  // The allowlist is the blast-radius half of the agda_apply_edit
  // sandbox. A user-supplied path may lexically live under the repo
  // root but still target a file that agda_apply_edit should refuse
  // to touch (shell scripts, package.json, .git, Makefile, ...).
  // These tests pin the exact set we accept.

  test("accepts .agda", () => {
    expect(hasAgdaSourceExtension("/repo/src/Foo.agda")).toBe(true);
  });

  test("accepts .lagda", () => {
    expect(hasAgdaSourceExtension("/repo/src/Foo.lagda")).toBe(true);
  });

  test("accepts .lagda.md, .lagda.rst, .lagda.tex, .lagda.org, .lagda.typ", () => {
    for (const ext of [".md", ".rst", ".tex", ".org", ".typ"]) {
      expect(hasAgdaSourceExtension(`/repo/src/Foo.lagda${ext}`)).toBe(true);
    }
  });

  test("is case-insensitive (FOO.AGDA)", () => {
    expect(hasAgdaSourceExtension("/repo/SRC/FOO.AGDA")).toBe(true);
    expect(hasAgdaSourceExtension("/repo/src/Foo.LaGdA")).toBe(true);
  });

  test.each([
    "/repo/package.json",
    "/repo/Makefile",
    "/repo/.git/config",
    "/repo/scripts/build.sh",
    "/repo/README.md",
    "/repo/src/Foo.hs",
    "/repo/src/Foo.ts",
    "/repo/src/Foo.py",
  ])("refuses %s", (path) => {
    expect(hasAgdaSourceExtension(path)).toBe(false);
  });

  test("refuses a file whose name merely contains '.agda' in the middle", () => {
    // Real-world: a file called `Foo.agda.bak` or `Foo.agdaignore`
    // is NOT an Agda source file and must not be editable through
    // agda_apply_edit.
    expect(hasAgdaSourceExtension("/repo/src/Foo.agda.bak")).toBe(false);
    expect(hasAgdaSourceExtension("/repo/src/.agdaignore")).toBe(false);
  });

  test("refuses empty string", () => {
    expect(hasAgdaSourceExtension("")).toBe(false);
  });

  test("AGDA_SOURCE_EXTENSIONS is non-empty and every entry starts with .", () => {
    expect(AGDA_SOURCE_EXTENSIONS.length).toBeGreaterThan(0);
    for (const ext of AGDA_SOURCE_EXTENSIONS) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});
