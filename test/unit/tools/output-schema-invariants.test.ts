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

import { describe, test, expect, beforeAll, afterAll } from "vitest";

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

afterAll(() => {
  // Tear down so the duplicate-name guard in registerManifestEntry
  // doesn't make a sibling test order-dependent.
  clearToolManifest();
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

  test(
    "every exposed tool exposes at least one structured field beyond text/goalId — issue #11",
    () => {
      // Issue #11 scope item: "expand richer per-tool data beyond plain
      // text where still missing". Every tool must expose at least one
      // output field beyond the bare-minimum `text` and (optionally)
      // `goalId` — so a tool that ships with a default `{text}` (or
      // `{text, goalId}`) schema fails the suite. This is the
      // forward-looking fence: any new tool added without a richer
      // schema has to either earn an enrichment or get an explicit
      // exception in this list.
      //
      // The exception list is empty by design today — every tool was
      // enriched in the same PR that added this fence. Keep it empty
      // unless there is a well-argued reason a future tool genuinely
      // has no machine-decodable data beyond the prose body.
      const TEXT_ONLY_EXCEPTIONS = new Set<string>();

      const offenders = listToolManifest().filter((entry) => {
        if (TEXT_ONLY_EXCEPTIONS.has(entry.name)) return false;
        const richFields = entry.outputFields.filter(
          (f) => f !== "text" && f !== "goalId",
        );
        return richFields.length === 0;
      });

      expect(
        offenders.map((e) => e.name),
        "tools with no structured data beyond {text}/{text,goalId}",
      ).toEqual([]);
    },
  );
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

  test("load classifies source-only hole markers as ok-with-holes even when goals/invisibleGoalCount are zero", () => {
    // Issue #11 / regression for the v0.6.6 source-hole scan: a load
    // can succeed, report zero protocol goals AND zero invisible
    // goals, yet still be ok-with-holes if the source contains
    // explicit hole markers (`{!!}` / `?` / `{! expr !}`) that Agda
    // failed to surface (e.g. holes inside `abstract` blocks).
    // `LoadResult.hasHoles` carries the source-scan signal — when it
    // is true and the load was successful, the classification must be
    // `ok-with-holes`, not `ok-complete`. `classifyCompleteness`
    // alone can't see the source markers because its `CompletenessInput`
    // only sees the protocol counts, but `completenessFromLoadResult`
    // pulls from a `LoadResult` that already encodes the merged
    // signal. Pin the merged shape so any future refactor that
    // re-derives completeness from `goals.length` only is caught
    // here.
    const sourceOnlyHoleResult = completenessFromLoadResult({
      success: true,
      errors: [],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: true,
      isComplete: false,
      classification: "ok-with-holes",
    });

    // The completeness helper round-trips the protocol-derived counts;
    // the merged hasHoles signal lives on the LoadResult itself. The
    // classification on the result must already be ok-with-holes —
    // assert that it survives the helper unchanged so a future bug
    // that recomputes the field from `goals.length` (and would yield
    // ok-complete) is caught.
    expect(sourceOnlyHoleResult.classification).toBe("ok-with-holes");

    // And the protocol-input form (no source-scan signal) must agree
    // with its own zero-counts shape — surfacing the divergence
    // precisely as the load helper reading from the merged result.
    const protocolOnly = classifyCompleteness({
      success: true,
      goals: [],
      invisibleGoalCount: 0,
    });
    expect(protocolOnly.classification).toBe("ok-complete");
    expect(protocolOnly.hasHoles).toBe(false);
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
