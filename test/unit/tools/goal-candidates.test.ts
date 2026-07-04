import { expect, test } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGoalCandidates } from "../../../src/tools/register-goal-candidates.js";
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

function makeSession(opts: {
  loadedFile?: string | null;
  goalIds?: number[];
  types?: Record<number, { type: string; context: string[] }>;
}) {
  return {
    getLoadedFile: () => (opts.loadedFile === undefined ? "/repo/F.agda" : opts.loadedFile),
    getGoalIds: () => opts.goalIds ?? [],
    isFileStale: () => false,
    goal: {
      typeContext: async (id: number) => {
        const info = opts.types?.[id];
        if (!info) throw new Error(`no goal ${id}`);
        return info;
      },
    },
  } as any;
}

test("agda_goal_candidates: no file loaded returns an error envelope", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  registerGoalCandidates(server as unknown as McpServer, makeSession({ loadedFile: null }), "/repo");
  const result = await server.get("agda_goal_candidates")!.callback({});
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("no-loaded-file");
});

test("agda_goal_candidates: type-directed local candidates per goal", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = makeSession({
    goalIds: [0, 1],
    types: {
      0: { type: "Nat", context: ["x : Nat", "f : Bool → Nat", "b : Bool"] },
      1: { type: "Bool", context: ["b : Bool", "{A : Set}"] },
    },
  });
  registerGoalCandidates(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_goal_candidates")!.callback({});

  const data = result.structuredContent.data;
  expect(data.totalGoals).toBe(2);
  expect(data.goalsWithCandidates).toBe(2);

  const g0 = data.goals.find((g: any) => g.goalId === 0);
  const names0 = Object.fromEntries(g0.candidates.map((c: any) => [c.name, c]));
  expect(names0.x).toMatchObject({ match: "exact", arity: 0 });
  expect(names0.f).toMatchObject({ match: "result", arity: 1 });
  expect(names0.b).toBeUndefined(); // Bool ≠ Nat

  const g1 = data.goals.find((g: any) => g.goalId === 1);
  expect(g1.candidates.map((c: any) => c.name)).toEqual(["b"]);
});

test("agda_goal_candidates: limitPerGoal caps candidates and reports the overflow", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const context = [1, 2, 3, 4, 5].map((n) => `v${n} : Nat`);
  const session = makeSession({ goalIds: [0], types: { 0: { type: "Nat", context } } });
  registerGoalCandidates(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_goal_candidates")!.callback({ limitPerGoal: 2 });

  const g0 = result.structuredContent.data.goals[0];
  expect(g0.candidateCount).toBe(5);
  expect(g0.candidates.length).toBe(2);
  expect(result.content[0].text).toContain("and 3 more");
});

test("agda_goal_candidates: a failed goal query is counted, not fatal", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = makeSession({ goalIds: [0, 9], types: { 0: { type: "Nat", context: ["x : Nat"] } } });
  registerGoalCandidates(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_goal_candidates")!.callback({});

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.failedGoalQueries).toBe(1);
  expect(result.structuredContent.data.goals.length).toBe(2);
  // The failed goal must NOT be reported as "no local term matches" — that
  // conflates a query failure with a genuinely empty candidate set.
  expect(result.content[0].text).toContain("Could not query this goal");
  expect(result.content[0].text).not.toContain("### ?9 :");
});
