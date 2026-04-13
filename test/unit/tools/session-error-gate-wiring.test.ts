import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgdaSession } from "../../../src/agda-process.js";

import { register as registerScopeTools } from "../../../src/tools/scope-tools.js";
import { register as registerExpressionTools } from "../../../src/tools/expression-tools.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

// Verify that §1.3 of the observations doc is wired into every
// query-style tool: when the session's most recent load ended in
// type-error, the tool short-circuits to an "unavailable" envelope
// without talking to Agda. The individual gate logic is covered in
// tool-helpers.test.ts; these tests are about *wiring* — if a future
// refactor drops the gate call from one of the five tools, the drop
// has to be noticed here.

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

interface SpyCounter {
  count: number;
}

function stubFailingSession(spy: SpyCounter): AgdaSession {
  const bomb = async () => {
    spy.count += 1;
    throw new Error("unreachable: query should never reach the session in error state");
  };
  return {
    getLastClassification: () => "type-error",
    getLoadedFile: () => "/repo/src/Broken.agda",
    getGoalIds: () => [],
    isFileStale: () => false,
    query: {
      whyInScope: bomb,
      whyInScopeTopLevel: bomb,
      showModuleContents: bomb,
      showModuleContentsTopLevel: bomb,
      searchAbout: bomb,
    },
    expr: {
      compute: bomb,
      computeTopLevel: bomb,
      infer: bomb,
      inferTopLevel: bomb,
    },
  } as unknown as AgdaSession;
}

function expectUnavailable(result: any, toolName: string): void {
  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.classification).toBe("unavailable");
  expect(result.structuredContent.summary).toContain(toolName);
  expect(result.structuredContent.summary).toContain("type-error");
  const diag = result.structuredContent.diagnostics[0];
  expect(diag.code).toBe("session-unavailable");
  expect(diag.severity).toBe("error");
}

test("agda_why_in_scope gates on session error state", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const spy: SpyCounter = { count: 0 };
  registerScopeTools(server as unknown as McpServer, stubFailingSession(spy), "/repo");

  const result = await server.get("agda_why_in_scope")!.callback({ name: "_+_" });
  expectUnavailable(result, "agda_why_in_scope");
  expect(spy.count).toBe(0);
});

test("agda_show_module gates on session error state", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const spy: SpyCounter = { count: 0 };
  registerScopeTools(server as unknown as McpServer, stubFailingSession(spy), "/repo");

  const result = await server.get("agda_show_module")!.callback({ moduleName: "Data.Nat" });
  expectUnavailable(result, "agda_show_module");
  expect(spy.count).toBe(0);
});

test("agda_search_about gates on session error state", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const spy: SpyCounter = { count: 0 };
  registerScopeTools(server as unknown as McpServer, stubFailingSession(spy), "/repo");

  const result = await server.get("agda_search_about")!.callback({ query: "_+_" });
  expectUnavailable(result, "agda_search_about");
  expect(spy.count).toBe(0);
});

test("agda_infer gates on session error state", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const spy: SpyCounter = { count: 0 };
  registerExpressionTools(server as unknown as McpServer, stubFailingSession(spy), "/repo");

  const result = await server.get("agda_infer")!.callback({ expr: "zero" });
  expectUnavailable(result, "agda_infer");
  expect(spy.count).toBe(0);
});

test("agda_compute gates on session error state", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const spy: SpyCounter = { count: 0 };
  registerExpressionTools(server as unknown as McpServer, stubFailingSession(spy), "/repo");

  const result = await server.get("agda_compute")!.callback({ expr: "suc zero" });
  expectUnavailable(result, "agda_compute");
  expect(spy.count).toBe(0);
});
