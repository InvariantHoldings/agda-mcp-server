import { expect, test } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerAnalysisTools } from "../../../src/tools/analysis-tools.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

function createCapturingServer() {
  const registrations = new Map<string, { callback: (args: any) => any }>();
  return {
    registerTool(name: string, _spec: unknown, callback: (args: any) => any) {
      registrations.set(name, { callback });
    },
    get(name: string) {
      return registrations.get(name);
    },
  };
}

test("agda_term_search imported scope labels candidates as imported", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    getGoalIds: () => [1],
    getLastClassification: () => null,
    getLoadedFile: () => "/repo/Example.agda",
    isFileStale: () => false,
    goal: {
      typeContext: async () => ({
        type: "Nat",
        context: ["x : Nat"],
      }),
    },
    query: {
      searchAbout: async () => ({
        query: "Nat",
        results: [{ name: "helper", term: "Nat" }],
        text: "",
      }),
    },
    load: async () => ({ success: true, errors: [], warnings: [], goals: [], allGoalsText: "", invisibleGoalCount: 0, goalCount: 0, hasHoles: false, isComplete: true, classification: "ok-complete", profiling: null }),
  } as any;

  registerAnalysisTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_term_search")!.callback({
    goalId: 1,
    scope: "imported",
  });

  expect(result.isError).toBe(false);
  expect(result.content[0].text).toContain("(imported)");
  expect(result.content[0].text).not.toContain("(module)");
});

