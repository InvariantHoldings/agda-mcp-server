// MIT License — see LICENSE
//
// Output-schema invariants for every exposed MCP tool.
//
// Issue #11 acceptance criteria:
//   - every exposed tool has a declared output schema
//   - completeness fields agree across load/typecheck flows
//   - unit tests cover envelope and classification invariants
//
// `registerStructuredTool` already requires an `outputDataSchema` at the
// type level, so the structural guarantee exists. These tests close the
// remaining hole — that no tool slips through with an empty Zod object —
// and act as a regression fence so any future tool added without
// declared output fields fails the suite at registration time.

import { describe, test, expect, beforeAll } from "vitest";

import {
  clearToolManifest,
  listToolManifest,
  listToolSchemas,
} from "../../../src/tools/manifest.js";
import { registerCoreTools } from "../../../src/tools/register-core-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgdaSession } from "../../../src/agda-process.js";
import {
  classifyCompleteness,
  completenessFromLoadResult,
  completenessFromTypeCheckResult,
} from "../../../src/agda/completeness.js";

beforeAll(() => {
  // The manifest is process-global. Clear-and-register so the suite is
  // self-contained and independent of order against other tests that
  // may have registered tools earlier in the run.
  clearToolManifest();
  const server = new McpServer({ name: "test", version: "0.0.0-test" });
  const session = new AgdaSession(process.cwd());
  try {
    registerCoreTools(server, session, process.cwd());
  } finally {
    session.destroy();
  }
});

describe("output-schema invariants — every exposed tool", () => {
  test("registers at least one tool", () => {
    // Sanity check — if registration silently no-ops the invariants
    // below are trivially satisfied. Guard against that.
    expect(listToolManifest().length).toBeGreaterThan(0);
  });

  test("every registered tool declares at least one outputField", () => {
    const empties = listToolManifest().filter(
      (entry) => entry.outputFields.length === 0,
    );
    expect(empties.map((e) => e.name)).toEqual([]);
  });

  test("every registered tool's output schema describes at least one field", () => {
    const empties = listToolSchemas().filter(
      (entry) => Object.keys(entry.outputSchema).length === 0,
    );
    expect(empties.map((e) => e.name)).toEqual([]);
  });

  test("every output field has a non-empty type description", () => {
    const offenders: Array<{ tool: string; field: string }> = [];
    for (const entry of listToolSchemas()) {
      for (const [field, type] of Object.entries(entry.outputSchema)) {
        if (typeof type !== "string" || type.length === 0 || type === "unknown") {
          offenders.push({ tool: entry.name, field });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every registered tool has a manifest category", () => {
    const uncategorized = listToolManifest().filter(
      (entry) => typeof entry.category !== "string" || entry.category.length === 0,
    );
    expect(uncategorized.map((e) => e.name)).toEqual([]);
  });
});

describe("completeness invariants — load/typecheck agreement", () => {
  test("classifyCompleteness is deterministic for identical inputs", () => {
    const input = { success: true, goals: [{}, {}], invisibleGoalCount: 1 };
    const a = classifyCompleteness(input);
    const b = classifyCompleteness(input);
    expect(a).toEqual(b);
  });

  test("load and typecheck classification agree on a successful empty result", () => {
    // Issue #11: completeness fields must agree across load/typecheck flows.
    // Identical underlying signal (success=true, no goals) must yield identical
    // classification regardless of which entry point built the result.
    const baseline = {
      success: true,
      errors: [] as string[],
      warnings: [] as string[],
      goals: [] as Array<{ goalId: number; type: string; context: unknown[] }>,
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: true,
      classification: "ok-complete" as const,
    };

    const loadStatus = completenessFromLoadResult({ ...baseline, allGoalsText: "" });
    const typecheckStatus = completenessFromTypeCheckResult(baseline);

    expect(loadStatus).toEqual(typecheckStatus);
    expect(loadStatus.classification).toBe("ok-complete");
    expect(loadStatus.isComplete).toBe(true);
  });

  test("load and typecheck classification agree on holes-with-success", () => {
    // The presence of any visible OR invisible goal must demote the
    // classification from `ok-complete` to `ok-with-holes` whether the
    // signal arrives through the load or typecheck path.
    const goals = [{ goalId: 0, type: "Nat", context: [] }];
    const loadStatus = completenessFromLoadResult({
      success: true,
      errors: [],
      warnings: [],
      goals,
      allGoalsText: "?0 : Nat",
      invisibleGoalCount: 0,
      goalCount: 1,
      hasHoles: true,
      isComplete: false,
      classification: "ok-with-holes",
    });
    const typecheckStatus = completenessFromTypeCheckResult({
      success: true,
      errors: [],
      warnings: [],
      goals,
      invisibleGoalCount: 0,
      goalCount: 1,
      hasHoles: true,
      isComplete: false,
      classification: "ok-with-holes",
    });

    expect(loadStatus).toEqual(typecheckStatus);
    expect(loadStatus.classification).toBe("ok-with-holes");
    expect(loadStatus.hasHoles).toBe(true);
    expect(loadStatus.isComplete).toBe(false);
  });

  test("load and typecheck classification agree on type-error", () => {
    const baseline = {
      success: false,
      errors: ["expected Nat, got Bool"],
      warnings: [] as string[],
      goals: [] as Array<{ goalId: number; type: string; context: unknown[] }>,
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error" as const,
    };
    const loadStatus = completenessFromLoadResult({ ...baseline, allGoalsText: "" });
    const typecheckStatus = completenessFromTypeCheckResult(baseline);

    expect(loadStatus).toEqual(typecheckStatus);
    expect(loadStatus.classification).toBe("type-error");
    expect(loadStatus.isComplete).toBe(false);
  });
});
