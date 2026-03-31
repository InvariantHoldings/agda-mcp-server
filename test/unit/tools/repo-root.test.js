import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  PROJECT_ROOT_ENV_VAR,
  SERVER_REPO_ROOT,
  resolveProjectPath,
  resolveProjectRoot,
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
