import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../../../src/agda-process.js";
import { clearToolManifest, listToolManifest } from "../../../src/tools/manifest.js";
import { registerCoreTools } from "../../../src/tools/register-core-tools.js";
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
  expect(new Set(names).size).toBe(names.length);

  for (const entry of mcpToolCoverageMatrix) {
    expect(existsSync(resolve(TEST_SERVER_REPO_ROOT, entry.suite))).toBeTruthy();
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

    expect(matrixNames).toEqual(manifestNames);
  } finally {
    session.destroy();
    clearToolManifest();
  }
});
