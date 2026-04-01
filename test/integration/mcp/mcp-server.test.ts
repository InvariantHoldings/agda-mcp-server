import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { createMcpHarness } from "../../helpers/mcp-harness.js";
import { TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";
import { navigationQueryMatrix } from "../../fixtures/agda/navigation-query-matrix.js";

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

async function withHarness(run: (harness: any) => Promise<void>, projectRoot = FIXTURES) {
  const harness = await createMcpHarness({
    serverRepoRoot: TEST_SERVER_REPO_ROOT,
    projectRoot,
  });

  try {
    return await run(harness);
  } finally {
    await harness.close();
  }
}

async function callToolStep(harness: any, label: string, name: string, args: Record<string, any> = {}) {
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
    const names = result.tools.map((tool: any) => tool.name);

    expect(names.includes("agda_load")).toBeTruthy();
    expect(names.includes("agda_tools_catalog")).toBeTruthy();
    expect(names.includes("agda_bug_report_bundle")).toBeTruthy();

    const loadTool = result.tools.find((tool: any) => tool.name === "agda_load");
    expect(loadTool).toBeTruthy();
    expect(loadTool.outputSchema?.type).toBe("object");
    expect("structuredContent" in (await harness.callTool("agda_tools_catalog", {}))).toBeTruthy();
  });
});

test("MCP harness can call agda_tools_catalog", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_tools_catalog", {});

    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_tools_catalog");
    expect(Array.isArray(result.structuredContent.data.tools)).toBeTruthy();
    expect(result.structuredContent.data.tools.some((tool: any) => tool.name === "agda_load")).toBeTruthy();
  });
});

test("MCP harness can call agda_protocol_parity", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_protocol_parity", {});

    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_protocol_parity");
    expect(Array.isArray(result.structuredContent.data.entries)).toBeTruthy();
    expect(result.structuredContent.data.entries.some((entry: any) => entry.agdaCommand === "Cmd_load")).toBeTruthy();
    const searchAbout = result.structuredContent.data.entries.find((entry: any) => entry.agdaCommand === "Cmd_search_about_toplevel");
    expect(searchAbout).toBeTruthy();
    expect(searchAbout.parityStatus).toBe("end-to-end");
  });
});

it("MCP harness can call agda_search_about after loading a fixture", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "SearchAboutTargets.agda" });
    expect(load.isError).toBe(false);

    const result = await harness.callTool("agda_search_about", { query: "Maybe" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_search_about");
    expect(result.structuredContent.data.query).toBe("Maybe");
    expect(result.structuredContent.data.results.some((entry: any) => entry.name === "mapMaybe")).toBeTruthy();
  });
});

it("MCP harness can call compute, infer, and context tools on expression fixtures", async () => {
  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load expression fixture", "agda_load", { file: "ExpressionQueries.agda" });
    expect(load.isError).toBe(false);
    expect(load.structuredContent.classification).toBe("ok-with-holes");
    expect(load.structuredContent.data.goalIds.length >= 1).toBeTruthy();

    const topInfer = await callToolStep(harness, "top-level infer", "agda_infer", { expr: "add" });
    expect(topInfer.isError).toBe(false);
    expect(topInfer.structuredContent.tool).toBe("agda_infer");
    expect(topInfer.structuredContent.data.inferredType.includes("Nat")).toBeTruthy();

    const topCompute = await callToolStep(
      harness,
      "top-level compute",
      "agda_compute",
      { expr: "add (suc zero) (suc zero)" },
    );
    expect(topCompute.isError).toBe(false);
    expect(topCompute.structuredContent.tool).toBe("agda_compute");
    expect(topCompute.structuredContent.data.normalForm.includes("suc")).toBeTruthy();

    const goalId = load.structuredContent.data.goalIds[0];
    const context = await callToolStep(harness, "goal context", "agda_context", { goalId });
    expect(context.isError).toBe(false);
    expect(context.content[0].text.includes("n : Nat")).toBeTruthy();
    expect(context.content[0].text.includes("m : Nat")).toBeTruthy();

    const goalInfer = await callToolStep(harness, "goal infer", "agda_infer", { goalId, expr: "add n m" });
    expect(goalInfer.isError).toBe(false);
    expect(goalInfer.structuredContent.data.inferredType.includes("Nat")).toBeTruthy();

    const goalCompute = await callToolStep(harness, "goal compute", "agda_compute", { goalId, expr: "add zero m" });
    expect(goalCompute.isError).toBe(false);
    expect(goalCompute.structuredContent.data.normalForm.includes("m")).toBeTruthy();
  });
});

it("MCP harness can call navigation and query tools on navigation fixtures", async () => {
  const scenario = navigationQueryMatrix[0];

  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load navigation fixture", "agda_load", { file: scenario.file });
    expect(load.isError).toBe(false);
    expect(load.structuredContent.data.goalIds.length >= 1).toBeTruthy();

    const topLevelWhy = await callToolStep(
      harness,
      "top-level why_in_scope",
      "agda_why_in_scope",
      { name: scenario.topLevel.whyInScope[0].name },
    );
    expect(topLevelWhy.isError).toBe(false);
    expect(topLevelWhy.structuredContent.data.explanation.includes("flip")).toBeTruthy();

    const topLevelModule = await callToolStep(
      harness,
      "top-level show_module",
      "agda_show_module",
      { moduleName: scenario.topLevel.showModule[0].moduleName },
    );
    expect(topLevelModule.isError).toBe(false);
    expect(topLevelModule.structuredContent.data.contents.includes("flip")).toBeTruthy();

    const goalId = load.structuredContent.data.goalIds[0];

    const goalWhy = await callToolStep(
      harness,
      "goal why_in_scope",
      "agda_why_in_scope",
      { goalId, name: scenario.goal.whyInScope[0].name },
    );
    expect(goalWhy.isError).toBe(false);
    expect(goalWhy.structuredContent.data.explanation.includes("n")).toBeTruthy();

    const goalModule = await callToolStep(
      harness,
      "goal show_module",
      "agda_show_module",
      { goalId, moduleName: scenario.goal.showModule[0].moduleName },
    );
    expect(goalModule.isError).toBe(false);
    expect(goalModule.structuredContent.data.contents.includes("Flag")).toBeTruthy();

    const elaborate = await callToolStep(
      harness,
      "goal elaborate",
      "agda_elaborate",
      { goalId, expr: scenario.goal.elaborate[0].expr },
    );
    expect(elaborate.isError).toBe(false);
    expect(elaborate.content[0].text.includes("add")).toBeTruthy();

    const helper = await callToolStep(
      harness,
      "goal helper_function",
      "agda_helper_function",
      { goalId, expr: scenario.goal.helperFunction[0].expr },
    );
    expect(helper.isError).toBe(false);
    expect(helper.content[0].text.includes("Nat")).toBeTruthy();
  });
});

it("MCP harness can call agda_show_version", async () => {
  await withHarness(async (harness) => {
    const version = await callToolStep(harness, "show version", "agda_show_version", {});

    expect(version.isError).toBe(false);
    expect(version.structuredContent.tool).toBe("agda_show_version");
    expect(version.structuredContent.data.version).toMatch(/[0-9]+\.[0-9]+/);
  });
});

it("MCP harness surfaces search_about results from nested public modules", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "SearchAboutNestedModules.agda" });
    expect(load.isError).toBe(false);

    const result = await harness.callTool("agda_search_about", { query: "Flag" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_search_about");
    expect(result.structuredContent.data.query).toBe("Flag");
    expect(result.structuredContent.data.results.some((entry: any) => entry.name === "flip")).toBeTruthy();
    expect(result.structuredContent.data.results.some((entry: any) => entry.name === "mapFlagMaybe")).toBeTruthy();
  });
});

it("MCP harness can load a fixture and inspect a goal through the built server", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "WithHoles.agda" });

    expect(load.isError).toBe(false);
    expect(load.structuredContent.tool).toBe("agda_load");
    expect(load.structuredContent.classification).toBe("ok-with-holes");
    expect(load.structuredContent.data.goalIds.length >= 1).toBeTruthy();

    const goalId = load.structuredContent.data.goalIds[0];
    const goal = await harness.callTool("agda_goal_type", { goalId });

    expect(goal.isError).toBe(false);
    expect(goal.structuredContent.tool).toBe("agda_goal_type");
    expect(goal.structuredContent.data.goalId).toBe(goalId);
    expect(goal.structuredContent.data.text.length > 0).toBeTruthy();
  });
});

it("MCP harness preserves goal access for imported-context holes", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "ImportedContextHole.agda" });

    expect(load.isError).toBe(false);
    expect(load.structuredContent.classification).toBe("ok-with-holes");
    expect(load.structuredContent.data.goalIds.length >= 1).toBeTruthy();

    const goalId = load.structuredContent.data.goalIds[0];
    const goal = await harness.callTool("agda_goal_type", { goalId });

    expect(goal.isError).toBe(false);
    expect(goal.structuredContent.data.text.includes("Nat")).toBeTruthy();
  });
});

it("MCP harness reports strict-load failure for ordinary holes", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_load_no_metas", { file: "WithHoles.agda" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_load_no_metas");
    expect(result.structuredContent.classification).toBe("type-error");
    expect(result.structuredContent.data.success).toBe(false);
    expect(result.structuredContent.data.isComplete).toBe(false);
  });
});

it("MCP harness reports strict-load failure for invisible-hole fixtures", async () => {
  await withHarness(async (harness) => {
    const result = await harness.callTool("agda_load_no_metas", { file: "WithAbstract.agda" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.tool).toBe("agda_load_no_metas");
    expect(result.structuredContent.classification).toBe("type-error");
    expect(result.structuredContent.data.success).toBe(false);
  });
});

it("MCP harness reports complete success for a clean fixture", async () => {
  await withHarness(async (harness) => {
    const load = await harness.callTool("agda_load", { file: "CompleteFixture.agda" });

    expect(load.isError).toBe(false);
    expect(load.structuredContent.classification).toBe("ok-complete");
    expect(load.structuredContent.data.goalCount).toBe(0);
    expect(load.structuredContent.data.isComplete).toBe(true);
  });
});
