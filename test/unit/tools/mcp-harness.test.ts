import { test, expect } from "vitest";
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

  expect(params.command).toBe(process.execPath);
  expect(params.args).toEqual([resolve(serverRepoRoot, "dist/index.js")]);
  expect(params.cwd).toBe(serverRepoRoot);
  expect(params.env.AGDA_MCP_ROOT).toBe(projectRoot);
  expect(params.env.FOO).toBe("bar");
  expect(params.stderr).toBe("pipe");
});
