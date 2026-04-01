import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, win32 } from "node:path";

import {
  PROJECT_ROOT_ENV_VAR,
  SERVER_REPO_ROOT,
  isPathWithinRoot,
  resolveProjectPath,
  resolveProjectRoot,
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../../src/repo-root.js";
import { TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

test("SERVER_REPO_ROOT points at this repository root", () => {
  expect(SERVER_REPO_ROOT).toBe(TEST_SERVER_REPO_ROOT);
});

test("resolveProjectRoot prefers AGDA_MCP_ROOT when present", () => {
  const configured = resolveProjectRoot({
    envRoot: "/tmp/example-project",
    cwd: "/tmp/fallback",
  });

  expect(configured).toBe(resolve("/tmp/example-project"));
});

test("resolveProjectRoot falls back to cwd when AGDA_MCP_ROOT is absent", () => {
  const configured = resolveProjectRoot({
    envRoot: undefined,
    cwd: "/tmp/fallback",
  });

  expect(configured).toBe("/tmp/fallback");
});

test("resolveProjectPath preserves absolute paths and resolves relative ones", () => {
  expect(resolveProjectPath("/repo", "src/index.ts")).toBe(resolve("/repo", "src/index.ts"));
  expect(resolveProjectPath("/repo", "/tmp/file.agda")).toBe("/tmp/file.agda");
});

test("project-root env var name is stable", () => {
  expect(PROJECT_ROOT_ENV_VAR).toBe("AGDA_MCP_ROOT");
});

// ── resolveFileWithinRoot ────────────────────────────────────────────

test("resolveFileWithinRoot resolves a simple relative path within root", () => {
  expect(
    resolveFileWithinRoot("/repo", "src/index.ts"),
  ).toBe(resolve("/repo/src/index.ts"));
});

test("resolveFileWithinRoot resolves a nested relative path within root", () => {
  expect(
    resolveFileWithinRoot("/repo", "a/b/../c"),
  ).toBe(resolve("/repo/a/c"));
});

test("resolveFileWithinRoot rejects a relative path that escapes root via ..", () => {
  expect(
    () => resolveFileWithinRoot("/repo", "../../etc/passwd"),
  ).toThrow(/escapes project root/);
});

test("resolveFileWithinRoot rejects an absolute path outside root", () => {
  expect(
    () => resolveFileWithinRoot("/repo", "/etc/passwd"),
  ).toThrow(/escapes project root/);
});

test("resolveFileWithinRoot rejects a path that escapes root with a single ..", () => {
  expect(
    () => resolveFileWithinRoot("/repo", "../sibling"),
  ).toThrow(/escapes project root/);
});

test("resolveFileWithinRoot allows the root itself as target", () => {
  expect(resolveFileWithinRoot("/repo", ".")).toBe(resolve("/repo"));
});

test("resolveFileWithinRoot allows an absolute path equal to root", () => {
  expect(resolveFileWithinRoot("/repo", "/repo")).toBe("/repo");
});

test("resolveFileWithinRoot allows any path when the project root is /", () => {
  expect(resolveFileWithinRoot("/", "/etc/hosts")).toBe("/etc/hosts");
});

test("resolveFileWithinRoot allows a path formed with join()", () => {
  expect(
    resolveFileWithinRoot("/repo", join("agda", "Kernel")),
  ).toBe(resolve("/repo/agda/Kernel"));
});

test("resolveFileWithinRoot rejects a join-constructed path that escapes root", () => {
  expect(
    () => resolveFileWithinRoot("/repo", join("agda", "../../etc")),
  ).toThrow(/escapes project root/);
});

test("isPathWithinRoot treats win32 drive-letter casing as equivalent", () => {
  expect(isPathWithinRoot("c:/repo", "C:/repo/file.agda", win32)).toBe(true);
  expect(isPathWithinRoot("c:/repo", "C:/other/file.agda", win32)).toBe(false);
});

test("isPathWithinRoot allows in-root segments that merely start with two dots", () => {
  expect(isPathWithinRoot("/repo", "/repo/..foo/file.agda")).toBe(true);
});

test("isPathWithinRoot does not treat backslash as a separator under the default POSIX path API", () => {
  expect(isPathWithinRoot("/repo", "/repo/..\\foo/file.agda")).toBe(true);
});

test("resolveExistingPathWithinRoot rejects symlink escapes outside the project root", (ctx) => {
  const sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-path-"));
  const repoRoot = join(sandbox, "repo");
  const outsideRoot = join(sandbox, "outside");
  const outsideFile = join(outsideRoot, "Secret.agda");
  const symlinkDir = join(repoRoot, "linked");

  mkdirSync(repoRoot);
  mkdirSync(outsideRoot);
  writeFileSync(outsideFile, "module Secret where\n");

  try {
    symlinkSync(outsideRoot, symlinkDir, "dir");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as any).code;
      if (code === "EPERM" || code === "EACCES") {
        ctx.skip();
        return;
      }
    }
    throw error;
  }

  try {
    expect(
      () => resolveExistingPathWithinRoot(repoRoot, "linked/Secret.agda"),
    ).toThrow(/resolves outside project root/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
