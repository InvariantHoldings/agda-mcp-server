// MIT License — see LICENSE
//
// Pin the safety net added in v0.6.7: every registerStructuredTool
// callback that throws gets translated into a structured error
// envelope, not a raw promise rejection. Without this, tools that
// touch user-controlled I/O (readFileSync on AGDA_BIN, recursive file
// walks, subprocess calls) could surface unstructured RPC failures.

import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { clearToolManifest } from "../../../src/tools/manifest.js";
import { registerStructuredTool } from "../../../src/tools/tool-registration.js";

function makeCapturingServer() {
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

test("registerStructuredTool catches synchronous throws and emits an error envelope", async () => {
  clearToolManifest();
  const server = makeCapturingServer();
  registerStructuredTool({
    server: server as unknown as McpServer,
    name: "test_sync_throw",
    description: "test",
    category: "analysis",
    outputDataSchema: z.object({}),
    callback: () => {
      throw new Error("synchronous boom");
    },
  });

  const result = await server.get("test_sync_throw")!.callback({});
  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  // The error message is preserved somewhere in the envelope.
  const haystack = JSON.stringify(result.structuredContent);
  expect(haystack).toMatch(/synchronous boom/u);
});

test("registerStructuredTool catches async rejections and emits an error envelope", async () => {
  clearToolManifest();
  const server = makeCapturingServer();
  registerStructuredTool({
    server: server as unknown as McpServer,
    name: "test_async_throw",
    description: "test",
    category: "analysis",
    outputDataSchema: z.object({}),
    callback: async () => {
      // Simulate the realistic case: an unhandled readFileSync /
      // statSync deep inside the callback that an author forgot to
      // wrap.
      await Promise.resolve();
      throw new Error("async boom");
    },
  });

  const result = await server.get("test_async_throw")!.callback({});
  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  const haystack = JSON.stringify(result.structuredContent);
  expect(haystack).toMatch(/async boom/u);
});

test("the elapsedMs timer still fires for callbacks that throw", async () => {
  clearToolManifest();
  const server = makeCapturingServer();
  registerStructuredTool({
    server: server as unknown as McpServer,
    name: "test_timed_throw",
    description: "test",
    category: "analysis",
    outputDataSchema: z.object({}),
    callback: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("timed boom");
    },
  });

  const result = await server.get("test_timed_throw")!.callback({});
  // The error envelope's elapsedMs (auto-filled) is non-negative;
  // pin that the timer wrapper still ran around the throwing path.
  expect(typeof result.structuredContent.elapsedMs).toBe("number");
  expect(result.structuredContent.elapsedMs).toBeGreaterThanOrEqual(0);
});

test("happy-path callbacks still pass through unchanged", async () => {
  clearToolManifest();
  const server = makeCapturingServer();
  registerStructuredTool({
    server: server as unknown as McpServer,
    name: "test_happy",
    description: "test",
    category: "analysis",
    outputDataSchema: z.object({ x: z.number() }),
    callback: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: {
        ok: true,
        tool: "test_happy",
        summary: "ok",
        data: { x: 42 },
      },
      isError: false,
    }),
  });

  const result = await server.get("test_happy")!.callback({});
  expect(result.isError).toBe(false);
  expect(result.structuredContent.ok).toBe(true);
  expect(result.structuredContent.data.x).toBe(42);
});
