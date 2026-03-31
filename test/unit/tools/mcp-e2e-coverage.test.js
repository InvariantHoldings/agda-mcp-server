import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../../../dist/agda-process.js";
import { clearToolManifest, listToolManifest } from "../../../dist/tools/manifest.js";
import { registerCoreTools } from "../../../dist/tools/register-core-tools.js";
import { mcpToolCoverageMatrix } from "../../fixtures/e2e/mcp-tool-coverage.js";
import { TEST_FIXTURE_PROJECT_ROOT, TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

function createServer() {
  return new McpServer({
    name: "test-server",
    version: "0.0.0-test",
  });
}

test("MCP E2E coverage matrix entries are unique and point at real suites", () => {
  const names = mcpToolCoverageMatrix.map((entry) => entry.tool);
  assert.equal(new Set(names).size, names.length);

  for (const entry of mcpToolCoverageMatrix) {
    assert.ok(existsSync(resolve(TEST_SERVER_REPO_ROOT, entry.suite)), `missing suite: ${entry.suite}`);
  }
});

test("every registered core tool has an MCP E2E coverage assignment", () => {
  clearToolManifest();
  const server = createServer();
  const session = new AgdaSession(TEST_FIXTURE_PROJECT_ROOT);

  try {
    registerCoreTools(server, session, TEST_FIXTURE_PROJECT_ROOT);

    const manifestNames = listToolManifest().map((entry) => entry.name).sort();
    const matrixNames = mcpToolCoverageMatrix.map((entry) => entry.tool).sort();

    assert.deepEqual(matrixNames, manifestNames);
  } finally {
    session.destroy();
    clearToolManifest();
  }
});
