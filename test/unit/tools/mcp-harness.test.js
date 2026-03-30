import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { buildHarnessServerParameters } from "../../helpers/mcp-harness.js";

test("buildHarnessServerParameters targets dist/index.js with AGDA_MCP_ROOT", () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const projectRoot = resolve(repoRoot, "test/fixtures/agda");

  const params = buildHarnessServerParameters({
    repoRoot,
    projectRoot,
    extraEnv: { FOO: "bar" },
  });

  assert.equal(params.command, process.execPath);
  assert.deepEqual(params.args, [resolve(repoRoot, "dist/index.js")]);
  assert.equal(params.cwd, repoRoot);
  assert.equal(params.env.AGDA_MCP_ROOT, projectRoot);
  assert.equal(params.env.FOO, "bar");
  assert.equal(params.stderr, "pipe");
});
