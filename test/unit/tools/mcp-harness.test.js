import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { buildHarnessServerParameters } from "../../helpers/mcp-harness.js";
import { TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

test("buildHarnessServerParameters targets dist/index.js with AGDA_MCP_ROOT", () => {
  const serverRepoRoot = TEST_SERVER_REPO_ROOT;
  const projectRoot = resolve(serverRepoRoot, "test/fixtures/agda");

  const params = buildHarnessServerParameters({
    serverRepoRoot,
    projectRoot,
    extraEnv: { FOO: "bar" },
  });

  assert.equal(params.command, process.execPath);
  assert.deepEqual(params.args, [resolve(serverRepoRoot, "dist/index.js")]);
  assert.equal(params.cwd, serverRepoRoot);
  assert.equal(params.env.AGDA_MCP_ROOT, projectRoot);
  assert.equal(params.env.FOO, "bar");
  assert.equal(params.stderr, "pipe");
});
