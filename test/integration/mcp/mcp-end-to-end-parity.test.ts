import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { createMcpHarness } from "../../helpers/mcp-harness.js";
import { TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

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

const itBackend = agdaAvailable
  && process.env.RUN_AGDA_INTEGRATION === "1"
  && process.env.RUN_AGDA_BACKEND_INTEGRATION === "1"
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

async function loadFixture(harness: any, file: string) {
  const load = await callToolStep(harness, "load fixture", "agda_load", { file });
  expect(load.isError).toBe(false);
  return load.structuredContent.data.goalIds;
}

function parseMetasCount(result: any) {
  const text = result.content[0].text;
  const match = text.match(/Unsolved goals \((\d+)\)/);
  expect(match).toBeTruthy();
  return Number(match[1]);
}

async function describeGoal(harness: any, goalId: number) {
  const goal = await callToolStep(harness, "goal type", "agda_goal", { goalId });
  const context = await callToolStep(harness, "goal context", "agda_context", { goalId });
  return {
    goalId,
    goalText: goal.content[0].text,
    contextText: context.content[0].text,
  };
}

async function findGoalId(harness: any, goalIds: number[], predicate: (info: any) => boolean, label: string) {
  for (const goalId of goalIds) {
    const info = await describeGoal(harness, goalId);
    if (predicate(info)) {
      return goalId;
    }
  }

  throw new Error(`Unable to find goal for ${label}`);
}

it("MCP end-to-end: proof query tools", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const natGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.goalText.includes("Nat") && !info.goalText.includes("\u2192") && info.contextText.includes("(empty context)"),
      "plain Nat goal",
    );

    const metas = await callToolStep(harness, "metas", "agda_metas", {});
    expect(metas.isError).toBe(false);
    expect(parseMetasCount(metas) >= 4).toBeTruthy();

    const constraints = await callToolStep(harness, "constraints", "agda_constraints", {});
    expect(constraints.isError).toBe(false);
    expect(constraints.content[0].text.includes("Constraints")).toBeTruthy();

    const goal = await callToolStep(harness, "goal", "agda_goal", { goalId: natGoalId });
    expect(goal.isError).toBe(false);
    expect(goal.content[0].text.includes("Nat")).toBeTruthy();

    const infer = await callToolStep(
      harness,
      "goal type/context infer",
      "agda_goal_type_context_infer",
      { goalId: natGoalId, expr: "zero" },
    );
    expect(infer.isError).toBe(false);
    expect(infer.content[0].text.includes("Nat")).toBeTruthy();

    const check = await callToolStep(
      harness,
      "goal type/context check",
      "agda_goal_type_context_check",
      { goalId: natGoalId, expr: "zero" },
    );
    expect(check.isError).toBe(false);
    expect(check.content[0].text.includes("zero")).toBeTruthy();
  });
});

it("MCP end-to-end: agda_give solves a goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const natGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.goalText.includes("Nat") && !info.goalText.includes("\u2192") && info.contextText.includes("(empty context)"),
      "plain Nat goal",
    );

    const before = await callToolStep(harness, "metas before give", "agda_metas", {});
    const beforeCount = parseMetasCount(before);

    const give = await callToolStep(harness, "give", "agda_give", { goalId: natGoalId, expr: "zero" });
    expect(give.isError).toBe(false);

    const after = await callToolStep(harness, "metas after give", "agda_metas", {});
    expect(parseMetasCount(after)).toBe(beforeCount - 1);
  });
});

it("MCP end-to-end: agda_refine and agda_refine_exact solve a simple goal", async () => {
  for (const toolName of ["agda_refine", "agda_refine_exact"]) {
    await withHarness(async (harness) => {
      const goalIds = await loadFixture(harness, "ProofActions.agda");
      const natGoalId = await findGoalId(
        harness,
        goalIds,
        (info) => info.goalText.includes("Nat") && !info.goalText.includes("\u2192") && info.contextText.includes("(empty context)"),
        "plain Nat goal",
      );

      const before = await callToolStep(harness, `metas before ${toolName}`, "agda_metas", {});
      const beforeCount = parseMetasCount(before);

      const refine = await callToolStep(harness, toolName, toolName, { goalId: natGoalId, expr: "zero" });
      expect(refine.isError).toBe(false);

      const after = await callToolStep(harness, `metas after ${toolName}`, "agda_metas", {});
      expect(parseMetasCount(after)).toBe(beforeCount - 1);
    });
  }
});

it("MCP end-to-end: agda_intro transforms a function goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const fnGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.goalText.includes("Nat \u2192 Nat"),
      "function goal",
    );

    const intro = await callToolStep(harness, "intro", "agda_intro", { goalId: fnGoalId });
    expect(intro.isError).toBe(false);

    const metas = await callToolStep(harness, "metas after intro", "agda_metas", {});
    expect(metas.isError).toBe(false);
    expect(metas.content[0].text.includes("Unsolved goals")).toBeTruthy();
  });
});

it("MCP end-to-end: agda_case_split returns generated clauses", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const caseGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.contextText.includes("n : Nat"),
      "case split goal",
    );

    const result = await callToolStep(harness, "case split", "agda_case_split", { goalId: caseGoalId, variable: "n" });
    expect(result.isError).toBe(false);
    expect(result.content[0].text.includes("zero")).toBeTruthy();
    expect(result.content[0].text.includes("suc")).toBeTruthy();
  });
});

it("MCP end-to-end: agda_auto solves a unique goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "SolveActions.agda");
    expect(goalIds.length).toBe(1);

    const result = await callToolStep(harness, "agda_auto", "agda_auto", { goalId: goalIds[0] });
    expect(result.isError).toBe(false);

    const metas = await callToolStep(harness, "metas after agda_auto", "agda_metas", {});
    expect(parseMetasCount(metas)).toBe(0);
  });
});

it("MCP end-to-end: agda_solve_one reports when no unique solution exists", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "SolveActions.agda");
    expect(goalIds.length).toBe(1);

    const result = await callToolStep(harness, "agda_solve_one", "agda_solve_one", { goalId: goalIds[0] });
    expect(result.isError).toBe(false);
    expect(result.content[0].text.includes("No unique solution found")).toBeTruthy();

    const metas = await callToolStep(harness, "metas after agda_solve_one", "agda_metas", {});
    expect(parseMetasCount(metas)).toBe(1);
  });
});

it("MCP end-to-end: agda_auto_all solves a unique goal set", async () => {
  await withHarness(async (harness) => {
    await loadFixture(harness, "SolveActions.agda");

    const result = await callToolStep(harness, "agda_auto_all", "agda_auto_all", {});
    expect(result.isError).toBe(false);

    const metas = await callToolStep(harness, "metas after agda_auto_all", "agda_metas", {});
    expect(parseMetasCount(metas)).toBe(0);
  });
});

it("MCP end-to-end: agda_solve_all reports when no unique solutions exist", async () => {
  await withHarness(async (harness) => {
    await loadFixture(harness, "SolveActions.agda");

    const result = await callToolStep(harness, "agda_solve_all", "agda_solve_all", {});
    expect(result.isError).toBe(false);
    expect(result.content[0].text.includes("No goals with unique solutions found")).toBeTruthy();

    const metas = await callToolStep(harness, "metas after agda_solve_all", "agda_metas", {});
    expect(parseMetasCount(metas)).toBe(1);
  });
});

it("MCP end-to-end: highlighting and display/process toggles", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const caseGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.contextText.includes("n : Nat"),
      "highlight goal",
    );

    const loadHighlighting = await callToolStep(
      harness,
      "load highlighting",
      "agda_load_highlighting_info",
      { file: "CompleteFixture.agda" },
    );
    expect(loadHighlighting.isError).toBe(false);

    const tokenHighlighting = await callToolStep(
      harness,
      "token highlighting keep",
      "agda_token_highlighting",
      { file: "CompleteFixture.agda", remove: false },
    );
    expect(tokenHighlighting.isError).toBe(false);

    const removeTokenHighlighting = await callToolStep(
      harness,
      "token highlighting remove",
      "agda_token_highlighting",
      { file: "CompleteFixture.agda", remove: true },
    );
    expect(removeTokenHighlighting.isError).toBe(false);

    const highlight = await callToolStep(
      harness,
      "highlight expression",
      "agda_highlight",
      { goalId: caseGoalId, expr: "n" },
    );
    expect(highlight.isError).toBe(false);

    const showImplicit = await callToolStep(
      harness,
      "show implicit args",
      "agda_show_implicit_args",
      { enabled: true },
    );
    expect(showImplicit.isError).toBe(false);

    const toggleImplicit = await callToolStep(harness, "toggle implicit args", "agda_toggle_implicit_args", {});
    expect(toggleImplicit.isError).toBe(false);

    const showIrrelevant = await callToolStep(
      harness,
      "show irrelevant args",
      "agda_show_irrelevant_args",
      { enabled: true },
    );
    expect(showIrrelevant.isError).toBe(false);

    const toggleIrrelevant = await callToolStep(harness, "toggle irrelevant args", "agda_toggle_irrelevant_args", {});
    expect(toggleIrrelevant.isError).toBe(false);
  });
});

it("MCP end-to-end: abort and exit process controls", async () => {
  const harness = await createMcpHarness({
    serverRepoRoot: TEST_SERVER_REPO_ROOT,
    projectRoot: FIXTURES,
  });

  try {
    const abort = await callToolStep(harness, "abort", "agda_abort", {});
    expect(abort.isError).toBe(false);
    expect(abort.structuredContent.data.delivered).toBe(true);

    const exit = await callToolStep(harness, "exit", "agda_exit", {});
    expect(exit.isError).toBe(false);
    expect(exit.structuredContent.data.delivered).toBe(true);
  } finally {
    await harness.close();
  }
});

itBackend("MCP end-to-end: backend tools", async () => {
  const backendExpr = process.env.AGDA_BACKEND_EXPR ?? "GHC";

  await withHarness(async (harness) => {
    const compileResult = await callToolStep(
      harness,
      "compile backend fixture",
      "agda_compile",
      { backend: backendExpr, file: "BackendNoHole.agda", args: [] },
    );
    expect(compileResult.isError).toBe(false);
    expect(compileResult.content[0].text.includes("Status:")).toBeTruthy();

    const goalIds = await loadFixture(harness, "BackendHole.agda");
    expect(goalIds.length >= 1).toBeTruthy();

    const topResult = await callToolStep(
      harness,
      "backend top payload",
      "agda_backend_top",
      { backend: backendExpr, payload: "ping" },
    );
    expect(topResult.isError).toBe(false);
    expect(topResult.content[0].text.includes("Status:")).toBeTruthy();

    const holeResult = await callToolStep(
      harness,
      "backend hole payload",
      "agda_backend_hole",
      { goalId: goalIds[0], holeContents: "", backend: backendExpr, payload: "ping-hole" },
    );
    expect(holeResult.isError).toBe(false);
    expect(holeResult.content[0].text.includes("Status:")).toBeTruthy();
  });
});
