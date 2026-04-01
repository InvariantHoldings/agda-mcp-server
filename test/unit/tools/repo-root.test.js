import test from "node:test";
import assert from "node:assert/strict";
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
} from "../../../dist/repo-root.js";
import { TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

test("SERVER_REPO_ROOT points at this repository root", () => {
  assert.equal(SERVER_REPO_ROOT, TEST_SERVER_REPO_ROOT);
});

test("resolveProjectRoot prefers AGDA_MCP_ROOT when present", () => {
  const configured = resolveProjectRoot({
    envRoot: "/tmp/example-project",
    cwd: "/tmp/fallback",
  });

  assert.equal(configured, resolve("/tmp/example-project"));
});

test("resolveProjectRoot falls back to cwd when AGDA_MCP_ROOT is absent", () => {
  const configured = resolveProjectRoot({
    envRoot: undefined,
    cwd: "/tmp/fallback",
  });

  assert.equal(configured, "/tmp/fallback");
});

test("resolveProjectPath preserves absolute paths and resolves relative ones", () => {
  assert.equal(resolveProjectPath("/repo", "src/index.ts"), resolve("/repo", "src/index.ts"));
  assert.equal(resolveProjectPath("/repo", "/tmp/file.agda"), "/tmp/file.agda");
});

test("project-root env var name is stable", () => {
  assert.equal(PROJECT_ROOT_ENV_VAR, "AGDA_MCP_ROOT");
});

// ── resolveFileWithinRoot ────────────────────────────────────────────

test("resolveFileWithinRoot resolves a simple relative path within root", () => {
  assert.equal(
    resolveFileWithinRoot("/repo", "src/index.ts"),
    resolve("/repo/src/index.ts"),
  );
});

test("resolveFileWithinRoot resolves a nested relative path within root", () => {
  assert.equal(
    resolveFileWithinRoot("/repo", "a/b/../c"),
    resolve("/repo/a/c"),
  );
});

test("resolveFileWithinRoot rejects a relative path that escapes root via ..", () => {
  assert.throws(
    () => resolveFileWithinRoot("/repo", "../../etc/passwd"),
    /escapes project root/,
  );
});

test("resolveFileWithinRoot rejects an absolute path outside root", () => {
  assert.throws(
    () => resolveFileWithinRoot("/repo", "/etc/passwd"),
    /escapes project root/,
  );
});

test("resolveFileWithinRoot rejects a path that escapes root with a single ..", () => {
  assert.throws(
    () => resolveFileWithinRoot("/repo", "../sibling"),
    /escapes project root/,
  );
});

test("resolveFileWithinRoot allows the root itself as target", () => {
  assert.equal(resolveFileWithinRoot("/repo", "."), resolve("/repo"));
});

test("resolveFileWithinRoot allows an absolute path equal to root", () => {
  assert.equal(resolveFileWithinRoot("/repo", "/repo"), "/repo");
});

test("resolveFileWithinRoot allows any path when the project root is /", () => {
  assert.equal(resolveFileWithinRoot("/", "/etc/hosts"), "/etc/hosts");
});

test("resolveFileWithinRoot allows a path formed with join()", () => {
  assert.equal(
    resolveFileWithinRoot("/repo", join("agda", "Kernel")),
    resolve("/repo/agda/Kernel"),
  );
});

test("resolveFileWithinRoot rejects a join-constructed path that escapes root", () => {
  assert.throws(
    () => resolveFileWithinRoot("/repo", join("agda", "../../etc")),
    /escapes project root/,
  );
});

test("isPathWithinRoot treats win32 drive-letter casing as equivalent", () => {
  assert.equal(isPathWithinRoot("c:/repo", "C:/repo/file.agda", win32), true);
  assert.equal(isPathWithinRoot("c:/repo", "C:/other/file.agda", win32), false);
});

test("isPathWithinRoot allows in-root segments that merely start with two dots", () => {
  assert.equal(isPathWithinRoot("/repo", "/repo/..foo/file.agda"), true);
});

test("resolveExistingPathWithinRoot rejects symlink escapes outside the project root", (t) => {
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
      const code = error.code;
      if (code === "EPERM" || code === "EACCES") {
        t.skip(`symlink creation is not permitted on this platform: ${code}`);
        return;
      }
    }
    throw error;
  }

  try {
    assert.throws(
      () => resolveExistingPathWithinRoot(repoRoot, "linked/Secret.agda"),
      /resolves outside project root/,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
