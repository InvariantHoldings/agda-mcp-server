import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { createMcpHarness } from "../helpers/mcp-harness.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const FIXTURES = resolve(import.meta.dirname, "../fixtures/agda");

let agdaAvailable = false;
try {
  execSync("agda --version", { stdio: "pipe" });
  agdaAvailable = true;
} catch {
  // Agda not in PATH
}

const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1"
  ? test
  : test.skip;

async function withHarness(run, projectRoot = FIXTURES) {
  const harness = await createMcpHarness({
    repoRoot: REPO_ROOT,
    projectRoot,
  });

  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}

test("MCP harness lists tools and exposes semantic schemas", async () => {
  await withHarness(async (harness) => {
    const result = await harness.listTools();
    const names = result.tools.map((tool) => tool.name);

    assert.ok(names.includes("agda_load"));
    assert.ok(names.includes("agda_tools_catalog"));
    assert.ok(names.includes("agda_bug_report_bundle"));

    const loadTool = result.tools.find((tool) => tool.name === "agda_load");
    assert.ok(loadTool);
    assert.equal(loadTool.outputSchema?.type, "object");
    assert.ok("structuredContent" in (await harness.callTool("agda_tools_catalog", {})));
  });
});

test("MCP harness can call agda_tools_catalog", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_tools_catalog", {});

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_tools_catalog");
    assert.ok(Array.isArray(result.structuredContent.data.tools));
    assert.ok(result.structuredContent.data.tools.some((tool) => tool.name === "agda_load"));
  });
});

it("MCP harness can load a fixture and inspect a goal through the built server", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "WithHoles.agda" });

    assert.equal(load.isError, false);
    assert.equal(load.structuredContent.tool, "agda_load");
    assert.equal(load.structuredContent.classification, "ok-with-holes");
    assert.ok(load.structuredContent.data.goalIds.length >= 1);

    const goalId = load.structuredContent.data.goalIds[0];
    const goal = await harness.callTool("agda_goal_type", { goalId });

    assert.equal(goal.isError, false);
    assert.equal(goal.structuredContent.tool, "agda_goal_type");
    assert.equal(goal.structuredContent.data.goalId, goalId);
    assert.ok(goal.structuredContent.data.text.length > 0);
  });
});

it("MCP harness preserves goal access for imported-context holes", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "ImportedContextHole.agda" });

    assert.equal(load.isError, false);
    assert.equal(load.structuredContent.classification, "ok-with-holes");
    assert.ok(load.structuredContent.data.goalIds.length >= 1);

    const goalId = load.structuredContent.data.goalIds[0];
    const goal = await harness.callTool("agda_goal_type", { goalId });

    assert.equal(goal.isError, false);
    assert.ok(goal.structuredContent.data.text.includes("Nat"));
  });
});

it("MCP harness reports strict-load failure for ordinary holes", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_load_no_metas", { file: "WithHoles.agda" });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_load_no_metas");
    assert.equal(result.structuredContent.classification, "type-error");
    assert.equal(result.structuredContent.data.success, false);
    assert.equal(result.structuredContent.data.isComplete, false);
  });
});

it("MCP harness reports strict-load failure for invisible-hole fixtures", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_load_no_metas", { file: "WithAbstract.agda" });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_load_no_metas");
    assert.equal(result.structuredContent.classification, "type-error");
    assert.equal(result.structuredContent.data.success, false);
  });
});

it("MCP harness reports complete success for a clean fixture", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "Clean.agda" });

    assert.equal(load.isError, false);
    assert.equal(load.structuredContent.classification, "ok-complete");
    assert.equal(load.structuredContent.data.goalCount, 0);
    assert.equal(load.structuredContent.data.isComplete, true);
  });
});
