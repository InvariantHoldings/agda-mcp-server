import { test, expect } from "vitest";
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

async function withHarness(run: (harness: any) => Promise<void>, projectRoot = TEST_FIXTURE_PROJECT_ROOT) {
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

function createFileToolProject() {
  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-file-tools-"));
  mkdirSync(resolve(root, "agda/Kernel"), { recursive: true });
  mkdirSync(resolve(root, "agda/Foundation"), { recursive: true });

  writeFileSync(
    resolve(root, "agda/Kernel/Sample.agda"),
    `module Kernel.Sample where

data Nat : Set where
  zero : Nat
  suc  : Nat \u2192 Nat

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
    expect(before.isError).toBe(false);
    expect(before.structuredContent.data.loadedFile).toBe(null);

    const typecheckClean = await callToolStep(
      harness,
      "typecheck clean fixture",
      "agda_typecheck",
      { file: "CompleteFixture.agda" },
    );
    expect(typecheckClean.isError).toBe(false);
    expect(typecheckClean.structuredContent.data.classification).toBe("ok-complete");

    const typecheckWithHoles = await callToolStep(
      harness,
      "typecheck fixture with holes",
      "agda_typecheck",
      { file: "WithHoles.agda" },
    );
    expect(typecheckWithHoles.isError).toBe(false);
    expect(typecheckWithHoles.structuredContent.data.classification).toBe("ok-with-holes");

    const load = await callToolStep(harness, "load with holes", "agda_load", { file: "WithHoles.agda" });
    expect(load.isError).toBe(false);

    const after = await callToolStep(harness, "session status after load", "agda_session_status", {});
    expect(after.isError).toBe(false);
    expect(after.structuredContent.data.loadedFile).toBe("WithHoles.agda");
    expect(after.structuredContent.data.goalIds.length >= 1).toBeTruthy();
    expect(after.content[0].text.includes("agda_goal_type")).toBeTruthy();
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
      expect(readModule.isError).toBe(false);
      expect(readModule.content[0].text.includes("needleDefinition")).toBeTruthy();

      const listModules = await callToolStep(
        harness,
        "list modules",
        "agda_list_modules",
        { tier: "Kernel" },
      );
      expect(listModules.isError).toBe(false);
      expect(listModules.content[0].text.includes("agda/Kernel/Sample.agda")).toBeTruthy();

      const checkPostulates = await callToolStep(
        harness,
        "check postulates",
        "agda_check_postulates",
        { file: "agda/Foundation/Postulated.agda" },
      );
      expect(checkPostulates.isError).toBe(false);
      expect(checkPostulates.content[0].text.includes("1 postulate")).toBeTruthy();

      const searchDefinitions = await callToolStep(
        harness,
        "search definitions",
        "agda_search_definitions",
        { query: "needleDefinition", tier: "Kernel" },
      );
      expect(searchDefinitions.isError).toBe(false);
      expect(searchDefinitions.content[0].text.includes("needleDefinition")).toBeTruthy();
    }, projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

it("MCP end-to-end: analysis tools", async () => {
  await withHarness(async (harness) => {
    const load = await callToolStep(harness, "load PatternMatch", "agda_load", { file: "PatternMatch.agda" });
    expect(load.isError).toBe(false);
    const goalId = load.structuredContent.data.goalIds[0];
    expect(typeof goalId).toBe("number");

    const proofStatus = await callToolStep(harness, "proof status", "agda_proof_status", {});
    expect(proofStatus.isError).toBe(false);
    expect(proofStatus.content[0].text.includes("Proof Status")).toBeTruthy();
    expect(proofStatus.content[0].text.includes("PatternMatch.agda")).toBeTruthy();

    const goalAnalysis = await callToolStep(harness, "goal analysis", "agda_goal_analysis", { goalId });
    expect(goalAnalysis.isError).toBe(false);
    expect(goalAnalysis.content[0].text.includes("Suggested Actions")).toBeTruthy();
    expect(goalAnalysis.content[0].text.includes("case_split")).toBeTruthy();

    const termSearch = await callToolStep(
      harness,
      "term search",
      "agda_term_search",
      { goalId, targetType: "Nat" },
    );
    expect(termSearch.isError).toBe(false);
    expect(termSearch.content[0].text.includes("n")).toBeTruthy();

    const reload = await callToolStep(harness, "reload", "agda_reload", {});
    expect(reload.isError).toBe(false);
    expect(reload.content[0].text.includes("Reload")).toBeTruthy();
    expect(reload.content[0].text.includes("Status")).toBeTruthy();
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
    expect(bundle.isError).toBe(false);
    expect(bundle.structuredContent.data.kind).toBe("new-bug");
    expect(bundle.structuredContent.data.bugFingerprint.length > 0).toBeTruthy();

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
    expect(update.isError).toBe(false);
    expect(update.structuredContent.data.kind).toBe("update");
    expect(update.structuredContent.data.existingIssue).toBe(4);
    expect(update.structuredContent.data.bugFingerprint.length > 0).toBeTruthy();
  });
});
