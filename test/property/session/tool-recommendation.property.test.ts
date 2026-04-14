// MIT License — see LICENSE
//
// Property-based tests for tool recommendation invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  deriveToolRecommendations,
  type RecommendationInput,
} from "../../../src/session/tool-recommendation.js";
import type { ToolManifestEntry } from "../../../src/tools/manifest.js";

// ── Generators ──────────────────────────────────────────────────────

const arbPhase = fc.constantFrom(
  "idle" as const,
  "starting" as const,
  "ready" as const,
  "loaded" as const,
  "busy" as const,
  "exiting" as const,
);

const arbClassification = fc.constantFrom(
  "ok-complete",
  "ok-with-holes",
  "type-error",
  null,
);

const fakeManifest: ToolManifestEntry[] = [
  { name: "agda_load", description: "", category: "session", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_goal_type", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_context", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_auto", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_case_split", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_refine", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_solve_all", description: "", category: "process", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_read_module", description: "", category: "navigation", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_search_about", description: "", category: "process", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_goal_catalog", description: "", category: "proof", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_session_snapshot", description: "", category: "reporting", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_tools_catalog", description: "", category: "reporting", protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_bug_report_bundle", description: "", category: "reporting", protocolCommands: [], inputFields: [], outputFields: [] },
];

const arbInput: fc.Arbitrary<RecommendationInput> = fc.record({
  phase: arbPhase,
  loadedFile: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
  stale: fc.boolean(),
  goalIds: fc.array(fc.nat({ max: 50 }), { minLength: 0, maxLength: 10 }),
  classification: arbClassification,
  availableTools: fc.constant(fakeManifest),
});

// ── Properties ──────────────────────────────────────────────────────

test("recommendations are always sorted by priority", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const recs = deriveToolRecommendations(input);
      for (let i = 1; i < recs.length; i++) {
        expect(recs[i].priority).toBeGreaterThanOrEqual(recs[i - 1].priority);
      }
    }),
  );
});

test("all recommended tools exist in manifest", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const recs = deriveToolRecommendations(input);
      const toolNames = new Set(input.availableTools.map((t) => t.name));
      for (const rec of recs) {
        expect(toolNames.has(rec.tool)).toBe(true);
      }
    }),
  );
});

test("every recommendation has non-empty tool and rationale", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const recs = deriveToolRecommendations(input);
      for (const rec of recs) {
        expect(rec.tool.length).toBeGreaterThan(0);
        expect(rec.rationale.length).toBeGreaterThan(0);
        expect(rec.priority).toBeGreaterThanOrEqual(1);
        expect(rec.category.length).toBeGreaterThan(0);
      }
    }),
  );
});

test("idle/ready phases always include agda_load", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom("idle" as const, "ready" as const),
      arbClassification,
      fc.boolean(),
      (phase, classification, stale) => {
        const recs = deriveToolRecommendations({
          phase,
          loadedFile: null,
          stale,
          goalIds: [],
          classification,
          availableTools: fakeManifest,
        });
        expect(recs.some((r) => r.tool === "agda_load")).toBe(true);
      },
    ),
  );
});

test("busy phase never recommends proof tools", async () => {
  await fc.assert(
    fc.property(arbClassification, (classification) => {
      const recs = deriveToolRecommendations({
        phase: "busy",
        loadedFile: "/x.agda",
        stale: false,
        goalIds: [0],
        classification,
        availableTools: fakeManifest,
      });
      const proofTools = ["agda_goal_type", "agda_case_split", "agda_auto", "agda_give", "agda_refine"];
      for (const rec of recs) {
        expect(proofTools).not.toContain(rec.tool);
      }
    }),
  );
});

test("starting phase suggests snapshot, never proof tools", async () => {
  await fc.assert(
    fc.property(arbClassification, (classification) => {
      const recs = deriveToolRecommendations({
        phase: "starting",
        loadedFile: null,
        stale: false,
        goalIds: [],
        classification,
        availableTools: fakeManifest,
      });
      const proofTools = ["agda_goal_type", "agda_case_split", "agda_auto", "agda_give", "agda_refine"];
      for (const rec of recs) {
        expect(proofTools).not.toContain(rec.tool);
      }
      if (recs.length > 0) {
        expect(recs[0].tool).toBe("agda_session_snapshot");
      }
    }),
  );
});

test("no duplicate tool recommendations", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const recs = deriveToolRecommendations(input);
      const tools = recs.map((r) => r.tool);
      expect(new Set(tools).size).toBe(tools.length);
    }),
  );
});

test("knownArgs is always a valid object", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const recs = deriveToolRecommendations(input);
      for (const rec of recs) {
        expect(typeof rec.knownArgs).toBe("object");
        expect(rec.knownArgs).not.toBeNull();
        expect(Array.isArray(rec.blockers)).toBe(true);
      }
    }),
  );
});

test("busy/exiting with empty manifest returns no recommendations", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom("busy" as const, "exiting" as const),
      arbClassification,
      (phase, classification) => {
        const recs = deriveToolRecommendations({
          phase,
          loadedFile: "/x.agda",
          stale: false,
          goalIds: [0],
          classification,
          availableTools: [], // empty manifest
        });
        expect(recs).toHaveLength(0);
      },
    ),
  );
});
