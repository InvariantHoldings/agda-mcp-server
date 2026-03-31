import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { createMcpHarness } from "../../helpers/mcp-harness.js";
import { TEST_FIXTURE_PROJECT_ROOT, TEST_SERVER_REPO_ROOT } from "../../helpers/repo-root.js";

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

async function withHarness(run, projectRoot = TEST_FIXTURE_PROJECT_ROOT) {
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

function createFileToolProject() {
  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-file-tools-"));
  mkdirSync(resolve(root, "agda/Kernel"), { recursive: true });
  mkdirSync(resolve(root, "agda/Foundation"), { recursive: true });

  writeFileSync(
    resolve(root, "agda/Kernel/Sample.agda"),
    `module Kernel.Sample where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

needleDefinition : Nat
needleDefinition = zero
`,
    "utf8",
  );

  writeFileSync(
    resolve(root, "agda/Foundation/Postulated.agda"),
    `module Foundation.Postulated where

postulate
  magic : Set
`,
    "utf8",
  );

  return root;
}

it("MCP end-to-end: session status and typecheck tools", async () => {
  await withHarness(async (harness) => {
    const before = await callToolStep(harness, "session status before load", "agda_session_status", {});
    assert.equal(before.isError, false);
    assert.equal(before.structuredContent.data.loadedFile, null);

    const typecheckClean = await callToolStep(
      harness,
      "typecheck clean fixture",
      "agda_typecheck",
      { file: "Clean.agda" },
    );
    assert.equal(typecheckClean.isError, false);
    assert.equal(typecheckClean.structuredContent.data.classification, "ok-complete");

    const typecheckWithHoles = await callToolStep(
      harness,
      "typecheck fixture with holes",
      "agda_typecheck",
      { file: "WithHoles.agda" },
    );
    assert.equal(typecheckWithHoles.isError, false);
    assert.equal(typecheckWithHoles.structuredContent.data.classification, "ok-with-holes");

    const load = await callToolStep(harness, "load with holes", "agda_load", { file: "WithHoles.agda" });
    assert.equal(load.isError, false);

    const after = await callToolStep(harness, "session status after load", "agda_session_status", {});
    assert.equal(after.isError, false);
    assert.equal(after.structuredContent.data.loadedFile, "WithHoles.agda");
    assert.ok(after.structuredContent.data.goalIds.length >= 1);
    assert.ok(after.content[0].text.includes("agda_goal_type"));
  });
});

test("MCP end-to-end: file navigation tools", async () => {
  const projectRoot = createFileToolProject();

  try {
    await withHarness(async (harness) => {
      const readModule = await callToolStep(
        harness,
        "read module",
        "agda_read_module",
        { file: "agda/Kernel/Sample.agda" },
      );
      assert.equal(readModule.isError, false);
      assert.ok(readModule.content[0].text.includes("needleDefinition"));

      const listModules = await callToolStep(
        harness,
        "list modules",
        "agda_list_modules",
        { tier: "Kernel" },
      );
      assert.equal(listModules.isError, false);
      assert.ok(listModules.content[0].text.includes("agda/Kernel/Sample.agda"));

      const checkPostulates = await callToolStep(
        harness,
        "check postulates",
        "agda_check_postulates",
        { file: "agda/Foundation/Postulated.agda" },
      );
      assert.equal(checkPostulates.isError, false);
      assert.ok(checkPostulates.content[0].text.includes("1 postulate"));

      const searchDefinitions = await callToolStep(
        harness,
        "search definitions",
        "agda_search_definitions",
        { query: "needleDefinition", tier: "Kernel" },
      );
      assert.equal(searchDefinitions.isError, false);
      assert.ok(searchDefinitions.content[0].text.includes("needleDefinition"));
    }, projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

it("MCP end-to-end: analysis tools", async () => {
  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load PatternMatch", "agda_load", { file: "PatternMatch.agda" });
    assert.equal(load.isError, false);
    const goalId = load.structuredContent.data.goalIds[0];
    assert.equal(typeof goalId, "number");

    const proofStatus = await callToolStep(harness, "proof status", "agda_proof_status", {});
    assert.equal(proofStatus.isError, false);
    assert.ok(proofStatus.content[0].text.includes("Proof Status"));
    assert.ok(proofStatus.content[0].text.includes("PatternMatch.agda"));

    const goalAnalysis = await callToolStep(harness, "goal analysis", "agda_goal_analysis", { goalId });
    assert.equal(goalAnalysis.isError, false);
    assert.ok(goalAnalysis.content[0].text.includes("Suggested Actions"));
    assert.ok(goalAnalysis.content[0].text.includes("case_split"));

    const termSearch = await callToolStep(
      harness,
      "term search",
      "agda_term_search",
      { goalId, targetType: "Nat" },
    );
    assert.equal(termSearch.isError, false);
    assert.ok(termSearch.content[0].text.includes("n"));

    const reload = await callToolStep(harness, "reload", "agda_reload", {});
    assert.equal(reload.isError, false);
    assert.ok(reload.content[0].text.includes("Reload"));
    assert.ok(reload.content[0].text.includes("Status"));
  });
});

it("MCP end-to-end: bug bundle tools", async () => {
  await withHarness(async (harness) => {
    const bundle = await callToolStep(
      harness,
      "bug bundle",
      "agda_bug_report_bundle",
      {
        affectedTool: "agda_load",
        classification: "ok-with-holes",
        observed: "Observed holes after load",
        expected: "Expected a complete file",
        reproduction: ["Load WithHoles.agda", "Inspect goal ids"],
        diagnostics: [{ severity: "warning", message: "holes remain", code: "holes" }],
        evidence: { fixture: "WithHoles.agda" },
        agdaCommandFamily: "Cmd_load",
      },
    );
    assert.equal(bundle.isError, false);
    assert.equal(bundle.structuredContent.data.kind, "new-bug");
    assert.ok(bundle.structuredContent.data.bugFingerprint.length > 0);

    const update = await callToolStep(
      harness,
      "bug update bundle",
      "agda_bug_report_update_bundle",
      {
        existingIssue: 4,
        affectedTool: "agda_load",
        classification: "ok-with-holes",
        observed: "Observed holes after load",
        expected: "Expected a complete file",
        reproduction: ["Load WithHoles.agda", "Inspect goal ids"],
        diagnostics: [{ severity: "warning", message: "holes remain", code: "holes" }],
        evidence: { fixture: "WithHoles.agda" },
        agdaCommandFamily: "Cmd_load",
      },
    );
    assert.equal(update.isError, false);
    assert.equal(update.structuredContent.data.kind, "update");
    assert.equal(update.structuredContent.data.existingIssue, 4);
    assert.ok(update.structuredContent.data.bugFingerprint.length > 0);
  });
});
