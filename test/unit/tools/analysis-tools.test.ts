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

function makeTermSearchSession(searchResults: Array<{ name: string; term: string }>, opts?: { searchThrows?: boolean }) {
  return {
    getGoalIds: () => [1],
    getLastClassification: () => null,
    getLoadedFile: () => "/repo/Example.agda",
    isFileStale: () => false,
    goal: {
      typeContext: async () => ({ type: "Nat", context: ["x : Nat"] }),
    },
    query: {
      searchAbout: async () => {
        if (opts?.searchThrows) throw new Error("searchAbout must not run for local scope");
        return { query: "Nat", results: searchResults, text: "" };
      },
    },
  } as any;
}

test("agda_term_search local scope stays in context and never runs searchAbout", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  // searchAbout throws — a local-scope search must not reach it.
  const session = makeTermSearchSession([], { searchThrows: true });

  registerAnalysisTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_term_search")!.callback({ goalId: 1, scope: "local" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.scope).toBe("local");
  expect(data.matches.every((m: { source: string }) => m.source === "local")).toBe(true);
  expect(data.matches.length).toBeGreaterThan(0);
  // The name-relatedness caveat is only emitted for non-local scope.
  expect(result.content[0].text).not.toContain("name-relatedness");
});

test("agda_term_search paginates module candidates via offset/limit/hasMore", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const results = [1, 2, 3, 4, 5].map((n) => ({ name: `h${n}`, term: "Nat" }));
  const session = makeTermSearchSession(results);

  registerAnalysisTools(server as unknown as McpServer, session, "/repo");
  const call = (offset: number, limit: number) =>
    server.get("agda_term_search")!.callback({ goalId: 1, scope: "module", offset, limit });

  // 1 local (x : Nat) + 5 module candidates = 6 total.
  const page1 = (await call(0, 2)).structuredContent.data;
  expect(page1.totalCandidates).toBe(6);
  expect(page1.matches.length).toBe(2);
  expect(page1.hasMore).toBe(true);

  const page3 = (await call(4, 2)).structuredContent.data;
  expect(page3.matches.length).toBe(2);
  expect(page3.hasMore).toBe(false);
});

