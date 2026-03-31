import test from "node:test";
import assert from "node:assert/strict";
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

async function withHarness(run, projectRoot = FIXTURES) {
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

async function loadFixture(harness, file) {
  const load = await callToolStep(harness, "load fixture", "agda_load", { file });
  assert.equal(load.isError, false);
  return load.structuredContent.data.goalIds;
}

function parseMetasCount(result) {
  const text = result.content[0].text;
  const match = text.match(/Unsolved goals \((\d+)\)/);
  assert.ok(match, `missing metas count in ${text}`);
  return Number(match[1]);
}

async function describeGoal(harness, goalId) {
  const goal = await callToolStep(harness, "goal type", "agda_goal", { goalId });
  const context = await callToolStep(harness, "goal context", "agda_context", { goalId });
  return {
    goalId,
    goalText: goal.content[0].text,
    contextText: context.content[0].text,
  };
}

async function findGoalId(harness, goalIds, predicate, label) {
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
      (info) => info.goalText.includes("Nat") && !info.goalText.includes("→") && info.contextText.includes("(empty context)"),
      "plain Nat goal",
    );

    const metas = await callToolStep(harness, "metas", "agda_metas", {});
    assert.equal(metas.isError, false);
    assert.ok(parseMetasCount(metas) >= 4);

    const constraints = await callToolStep(harness, "constraints", "agda_constraints", {});
    assert.equal(constraints.isError, false);
    assert.ok(constraints.content[0].text.includes("Constraints"));

    const goal = await callToolStep(harness, "goal", "agda_goal", { goalId: natGoalId });
    assert.equal(goal.isError, false);
    assert.ok(goal.content[0].text.includes("Nat"));

    const infer = await callToolStep(
      harness,
      "goal type/context infer",
      "agda_goal_type_context_infer",
      { goalId: natGoalId, expr: "zero" },
    );
    assert.equal(infer.isError, false);
    assert.ok(infer.content[0].text.includes("Nat"));

    const check = await callToolStep(
      harness,
      "goal type/context check",
      "agda_goal_type_context_check",
      { goalId: natGoalId, expr: "zero" },
    );
    assert.equal(check.isError, false);
    assert.ok(check.content[0].text.includes("zero"));
  });
});

it("MCP end-to-end: agda_give solves a goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const natGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.goalText.includes("Nat") && !info.goalText.includes("→") && info.contextText.includes("(empty context)"),
      "plain Nat goal",
    );

    const before = await callToolStep(harness, "metas before give", "agda_metas", {});
    const beforeCount = parseMetasCount(before);

    const give = await callToolStep(harness, "give", "agda_give", { goalId: natGoalId, expr: "zero" });
    assert.equal(give.isError, false);

    const after = await callToolStep(harness, "metas after give", "agda_metas", {});
    assert.equal(parseMetasCount(after), beforeCount - 1);
  });
});

it("MCP end-to-end: agda_refine and agda_refine_exact solve a simple goal", async () => {
  for (const toolName of ["agda_refine", "agda_refine_exact"]) {
    await withHarness(async (harness) => {
      const goalIds = await loadFixture(harness, "ProofActions.agda");
      const natGoalId = await findGoalId(
        harness,
        goalIds,
        (info) => info.goalText.includes("Nat") && !info.goalText.includes("→") && info.contextText.includes("(empty context)"),
        "plain Nat goal",
      );

      const before = await callToolStep(harness, `metas before ${toolName}`, "agda_metas", {});
      const beforeCount = parseMetasCount(before);

      const refine = await callToolStep(harness, toolName, toolName, { goalId: natGoalId, expr: "zero" });
      assert.equal(refine.isError, false);

      const after = await callToolStep(harness, `metas after ${toolName}`, "agda_metas", {});
      assert.equal(parseMetasCount(after), beforeCount - 1);
    });
  }
});

it("MCP end-to-end: agda_intro transforms a function goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "ProofActions.agda");
    const fnGoalId = await findGoalId(
      harness,
      goalIds,
      (info) => info.goalText.includes("Nat → Nat"),
      "function goal",
    );

    const intro = await callToolStep(harness, "intro", "agda_intro", { goalId: fnGoalId });
    assert.equal(intro.isError, false);

    const metas = await callToolStep(harness, "metas after intro", "agda_metas", {});
    assert.equal(metas.isError, false);
    assert.ok(metas.content[0].text.includes("Unsolved goals"));
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
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes("zero"));
    assert.ok(result.content[0].text.includes("suc"));
  });
});

it("MCP end-to-end: agda_auto solves a unique goal", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "SolveActions.agda");
    assert.equal(goalIds.length, 1);

    const result = await callToolStep(harness, "agda_auto", "agda_auto", { goalId: goalIds[0] });
    assert.equal(result.isError, false);

    const metas = await callToolStep(harness, "metas after agda_auto", "agda_metas", {});
    assert.equal(parseMetasCount(metas), 0);
  });
});

it("MCP end-to-end: agda_solve_one reports when no unique solution exists", async () => {
  await withHarness(async (harness) => {
    const goalIds = await loadFixture(harness, "SolveActions.agda");
    assert.equal(goalIds.length, 1);

    const result = await callToolStep(harness, "agda_solve_one", "agda_solve_one", { goalId: goalIds[0] });
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes("No unique solution found"));

    const metas = await callToolStep(harness, "metas after agda_solve_one", "agda_metas", {});
    assert.equal(parseMetasCount(metas), 1);
  });
});

it("MCP end-to-end: agda_auto_all solves a unique goal set", async () => {
  await withHarness(async (harness) => {
    await loadFixture(harness, "SolveActions.agda");

    const result = await callToolStep(harness, "agda_auto_all", "agda_auto_all", {});
    assert.equal(result.isError, false);

    const metas = await callToolStep(harness, "metas after agda_auto_all", "agda_metas", {});
    assert.equal(parseMetasCount(metas), 0);
  });
});

it("MCP end-to-end: agda_solve_all reports when no unique solutions exist", async () => {
  await withHarness(async (harness) => {
    await loadFixture(harness, "SolveActions.agda");

    const result = await callToolStep(harness, "agda_solve_all", "agda_solve_all", {});
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes("No goals with unique solutions found"));

    const metas = await callToolStep(harness, "metas after agda_solve_all", "agda_metas", {});
    assert.equal(parseMetasCount(metas), 1);
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
      { file: "Clean.agda" },
    );
    assert.equal(loadHighlighting.isError, false);

    const tokenHighlighting = await callToolStep(
      harness,
      "token highlighting keep",
      "agda_token_highlighting",
      { file: "Clean.agda", remove: false },
    );
    assert.equal(tokenHighlighting.isError, false);

    const removeTokenHighlighting = await callToolStep(
      harness,
      "token highlighting remove",
      "agda_token_highlighting",
      { file: "Clean.agda", remove: true },
    );
    assert.equal(removeTokenHighlighting.isError, false);

    const highlight = await callToolStep(
      harness,
      "highlight expression",
      "agda_highlight",
      { goalId: caseGoalId, expr: "n" },
    );
    assert.equal(highlight.isError, false);

    const showImplicit = await callToolStep(
      harness,
      "show implicit args",
      "agda_show_implicit_args",
      { enabled: true },
    );
    assert.equal(showImplicit.isError, false);

    const toggleImplicit = await callToolStep(harness, "toggle implicit args", "agda_toggle_implicit_args", {});
    assert.equal(toggleImplicit.isError, false);

    const showIrrelevant = await callToolStep(
      harness,
      "show irrelevant args",
      "agda_show_irrelevant_args",
      { enabled: true },
    );
    assert.equal(showIrrelevant.isError, false);

    const toggleIrrelevant = await callToolStep(harness, "toggle irrelevant args", "agda_toggle_irrelevant_args", {});
    assert.equal(toggleIrrelevant.isError, false);
  });
});

it("MCP end-to-end: abort and exit process controls", async () => {
  const harness = await createMcpHarness({
    serverRepoRoot: TEST_SERVER_REPO_ROOT,
    projectRoot: FIXTURES,
  });

  try {
    const abort = await callToolStep(harness, "abort", "agda_abort", {});
    assert.equal(abort.isError, false);
    assert.equal(abort.structuredContent.data.delivered, true);

    const exit = await callToolStep(harness, "exit", "agda_exit", {});
    assert.equal(exit.isError, false);
    assert.equal(exit.structuredContent.data.delivered, true);
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
    assert.equal(compileResult.isError, false);
    assert.ok(compileResult.content[0].text.includes("Status:"));

    const goalIds = await loadFixture(harness, "BackendHole.agda");
    assert.ok(goalIds.length >= 1);

    const topResult = await callToolStep(
      harness,
      "backend top payload",
      "agda_backend_top",
      { backend: backendExpr, payload: "ping" },
    );
    assert.equal(topResult.isError, false);
    assert.ok(topResult.content[0].text.includes("Status:"));

    const holeResult = await callToolStep(
      harness,
      "backend hole payload",
      "agda_backend_hole",
      { goalId: goalIds[0], holeContents: "", backend: backendExpr, payload: "ping-hole" },
    );
    assert.equal(holeResult.isError, false);
    assert.ok(holeResult.content[0].text.includes("Status:"));
  });
});
