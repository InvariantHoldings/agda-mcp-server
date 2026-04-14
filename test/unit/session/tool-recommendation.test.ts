// MIT License — see LICENSE
//
// Unit tests for tool recommendation domain logic.

import { describe, it, expect } from "vitest";

import {
  deriveToolRecommendations,
  type RecommendationInput,
} from "../../../src/session/tool-recommendation.js";

const fakeManifest = [
  { name: "agda_load", description: "", category: "session" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_goal_type", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_context", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_auto", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_case_split", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_refine", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_solve_all", description: "", category: "process" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_read_module", description: "", category: "navigation" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_search_about", description: "", category: "process" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_goal_catalog", description: "", category: "proof" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_session_snapshot", description: "", category: "reporting" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_tools_catalog", description: "", category: "reporting" as const, protocolCommands: [], inputFields: [], outputFields: [] },
  { name: "agda_bug_report_bundle", description: "", category: "reporting" as const, protocolCommands: [], inputFields: [], outputFields: [] },
];

function baseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    phase: "loaded",
    loadedFile: "/project/Foo.agda",
    stale: false,
    goalIds: [],
    classification: "ok-complete",
    availableTools: fakeManifest,
    ...overrides,
  };
}

describe("deriveToolRecommendations", () => {
  it("suggests load for idle phase", () => {
    const recs = deriveToolRecommendations(baseInput({
      phase: "idle",
      loadedFile: null,
      classification: null,
    }));
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].tool).toBe("agda_load");
    expect(recs[0].priority).toBe(1);
  });

  it("suggests snapshot for busy phase with blockers", () => {
    const recs = deriveToolRecommendations(baseInput({ phase: "busy" }));
    expect(recs).toHaveLength(1);
    expect(recs[0].tool).toBe("agda_session_snapshot");
    expect(recs[0].blockers.length).toBeGreaterThan(0);
  });

  it("suggests reload for stale file", () => {
    const recs = deriveToolRecommendations(baseInput({
      stale: true,
      classification: "ok-with-holes",
      goalIds: [0],
    }));
    expect(recs[0].tool).toBe("agda_load");
    expect(recs[0].knownArgs).toHaveProperty("file");
  });

  it("suggests proof tools for goals", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-with-holes",
      goalIds: [0, 1, 2],
    }));
    const tools = recs.map((r) => r.tool);
    expect(tools).toContain("agda_goal_catalog");
    expect(tools).toContain("agda_goal_type");
    expect(tools).toContain("agda_auto");
    expect(tools).toContain("agda_case_split");
  });

  it("pre-fills goalId for goal tools", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-with-holes",
      goalIds: [5, 6],
    }));
    const goalType = recs.find((r) => r.tool === "agda_goal_type");
    expect(goalType?.knownArgs.goalId).toBe(5);
  });

  it("suggests read and bug report for type-error", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "type-error",
    }));
    const tools = recs.map((r) => r.tool);
    expect(tools).toContain("agda_read_module");
    expect(tools).toContain("agda_load");
    expect(tools).toContain("agda_bug_report_bundle");
  });

  it("suggests search and read for complete module", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-complete",
    }));
    const tools = recs.map((r) => r.tool);
    expect(tools).toContain("agda_search_about");
    expect(tools).toContain("agda_read_module");
  });

  it("returns recommendations sorted by priority", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-with-holes",
      goalIds: [0, 1],
    }));
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].priority).toBeGreaterThanOrEqual(recs[i - 1].priority);
    }
  });

  it("only recommends tools from the manifest", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-with-holes",
      goalIds: [0],
      availableTools: [
        { name: "agda_load", description: "", category: "session" as const, protocolCommands: [], inputFields: [], outputFields: [] },
      ],
    }));
    // With only agda_load in manifest, goal tools shouldn't appear
    const tools = recs.map((r) => r.tool);
    expect(tools).not.toContain("agda_goal_type");
  });

  it("includes category from manifest", () => {
    const recs = deriveToolRecommendations(baseInput({
      classification: "ok-with-holes",
      goalIds: [0],
    }));
    const goalType = recs.find((r) => r.tool === "agda_goal_type");
    expect(goalType?.category).toBe("proof");
  });
});
