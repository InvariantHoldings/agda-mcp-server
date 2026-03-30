import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { createMcpHarness } from "../../helpers/mcp-harness.js";
import { navigationQueryMatrix } from "../../fixtures/agda/navigation-query-matrix.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

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

async function callToolStep(harness, label, name, args = {}) {
  try {
    return await harness.callTool(name, args);
  } catch (error) {
    const stderr = harness.getStderr().trim();
    const details = stderr ? `\nserver stderr:\n${stderr}` : "";
    throw new Error(
      `${label} failed for ${name}: ${error instanceof Error ? error.message : String(error)}${details}`,
    );
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

test("MCP harness can call agda_protocol_parity", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_protocol_parity", {});

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_protocol_parity");
    assert.ok(Array.isArray(result.structuredContent.data.entries));
    assert.ok(result.structuredContent.data.entries.some((entry) => entry.agdaCommand === "Cmd_load"));
    const searchAbout = result.structuredContent.data.entries.find((entry) => entry.agdaCommand === "Cmd_search_about_toplevel");
    assert.ok(searchAbout);
    assert.equal(searchAbout.parityStatus, "verified");
  });
});

it("MCP harness can call agda_search_about after loading a fixture", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "SearchAboutTargets.agda" });
    assert.equal(load.isError, false);

    const result = await harness.callTool("agda_search_about", { query: "Maybe" });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_search_about");
    assert.equal(result.structuredContent.data.query, "Maybe");
    assert.ok(result.structuredContent.data.results.some((entry) => entry.name === "mapMaybe"));
  });
});

it("MCP harness can call compute, infer, and context tools on expression fixtures", async () => {
  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load expression fixture", "agda_load", { file: "ExpressionQueries.agda" });
    assert.equal(load.isError, false);
    assert.equal(load.structuredContent.classification, "ok-with-holes");
    assert.ok(load.structuredContent.data.goalIds.length >= 1);

    const topInfer = await callToolStep(harness, "top-level infer", "agda_infer", { expr: "add" });
    assert.equal(topInfer.isError, false);
    assert.equal(topInfer.structuredContent.tool, "agda_infer");
    assert.ok(topInfer.structuredContent.data.inferredType.includes("Nat"));

    const topCompute = await callToolStep(
      harness,
      "top-level compute",
      "agda_compute",
      { expr: "add (suc zero) (suc zero)" },
    );
    assert.equal(topCompute.isError, false);
    assert.equal(topCompute.structuredContent.tool, "agda_compute");
    assert.ok(topCompute.structuredContent.data.normalForm.includes("suc"));

    const goalId = load.structuredContent.data.goalIds[0];
    const context = await callToolStep(harness, "goal context", "agda_context", { goalId });
    assert.equal(context.isError, false);
    assert.ok(context.content[0].text.includes("n : Nat"));
    assert.ok(context.content[0].text.includes("m : Nat"));

    const goalInfer = await callToolStep(harness, "goal infer", "agda_infer", { goalId, expr: "add n m" });
    assert.equal(goalInfer.isError, false);
    assert.ok(goalInfer.structuredContent.data.inferredType.includes("Nat"));

    const goalCompute = await callToolStep(harness, "goal compute", "agda_compute", { goalId, expr: "add zero m" });
    assert.equal(goalCompute.isError, false);
    assert.ok(goalCompute.structuredContent.data.normalForm.includes("m"));
  });
});

it("MCP harness can call navigation and query tools on navigation fixtures", async () => {
  const scenario = navigationQueryMatrix[0];

  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load navigation fixture", "agda_load", { file: scenario.file });
    assert.equal(load.isError, false);
    assert.ok(load.structuredContent.data.goalIds.length >= 1);

    const topLevelWhy = await callToolStep(
      harness,
      "top-level why_in_scope",
      "agda_why_in_scope",
      { name: scenario.topLevel.whyInScope[0].name },
    );
    assert.equal(topLevelWhy.isError, false);
    assert.ok(topLevelWhy.structuredContent.data.explanation.includes("flip"));

    const topLevelModule = await callToolStep(
      harness,
      "top-level show_module",
      "agda_show_module",
      { moduleName: scenario.topLevel.showModule[0].moduleName },
    );
    assert.equal(topLevelModule.isError, false);
    assert.ok(topLevelModule.structuredContent.data.contents.includes("flip"));

    const goalId = load.structuredContent.data.goalIds[0];

    const goalWhy = await callToolStep(
      harness,
      "goal why_in_scope",
      "agda_why_in_scope",
      { goalId, name: scenario.goal.whyInScope[0].name },
    );
    assert.equal(goalWhy.isError, false);
    assert.ok(goalWhy.structuredContent.data.explanation.includes("n"));

    const goalModule = await callToolStep(
      harness,
      "goal show_module",
      "agda_show_module",
      { goalId, moduleName: scenario.goal.showModule[0].moduleName },
    );
    assert.equal(goalModule.isError, false);
    assert.ok(goalModule.structuredContent.data.contents.includes("Flag"));

    const elaborate = await callToolStep(
      harness,
      "goal elaborate",
      "agda_elaborate",
      { goalId, expr: scenario.goal.elaborate[0].expr },
    );
    assert.equal(elaborate.isError, false);
    assert.ok(elaborate.content[0].text.includes("add"));

    const helper = await callToolStep(
      harness,
      "goal helper_function",
      "agda_helper_function",
      { goalId, expr: scenario.goal.helperFunction[0].expr },
    );
    assert.equal(helper.isError, false);
    assert.ok(helper.content[0].text.includes("Nat"));
  });
});

it("MCP harness can call agda_show_version", async () => {
  await withHarness(async (harness) => {
    const version = await callToolStep(harness, "show version", "agda_show_version", {});

    assert.equal(version.isError, false);
    assert.equal(version.structuredContent.tool, "agda_show_version");
    assert.match(version.structuredContent.data.version, /[0-9]+\.[0-9]+/);
  });
});

it("MCP harness surfaces search_about results from nested public modules", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "SearchAboutNestedModules.agda" });
    assert.equal(load.isError, false);

    const result = await harness.callTool("agda_search_about", { query: "Flag" });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.tool, "agda_search_about");
    assert.equal(result.structuredContent.data.query, "Flag");
    assert.ok(result.structuredContent.data.results.some((entry) => entry.name === "flip"));
    assert.ok(result.structuredContent.data.results.some((entry) => entry.name === "mapFlagMaybe"));
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
