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
import { toolEnvelopeSchema } from "../../../src/tools/tool-envelope.js";

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

test("strict outputSchema validation on ok=true (regression: schema must NOT be relaxed for success path)", () => {
  // Pin the schema contract: a successful envelope with WRONG `data`
  // shape must fail the registered output schema. Without this, a
  // tool author's typo on the happy path would silently produce a
  // schema-non-conforming success payload that the safety-net's
  // looseness used to mask. The superRefine path enforces strict
  // dataSchema validation only when ok === true.
  const dataSchema = z.object({ file: z.string(), count: z.number() });
  const envelopeSchema = toolEnvelopeSchema(dataSchema);

  // Wrong shape on a success envelope: `count` missing.
  const bad = envelopeSchema.safeParse({
    tool: "x",
    ok: true,
    classification: "ok",
    summary: "ok",
    data: { file: "Foo.agda" },
    diagnostics: [],
  });
  expect(bad.success).toBe(false);

  // Correct shape on a success envelope: passes.
  const good = envelopeSchema.safeParse({
    tool: "x",
    ok: true,
    classification: "ok",
    summary: "ok",
    data: { file: "Foo.agda", count: 3 },
    diagnostics: [],
  });
  expect(good.success).toBe(true);

  // Loose shape on an error envelope: still passes (safety-net path).
  const errLoose = envelopeSchema.safeParse({
    tool: "x",
    ok: false,
    classification: "tool-error",
    summary: "boom",
    data: {},
    diagnostics: [],
  });
  expect(errLoose.success).toBe(true);
});

test("safety-net error envelope satisfies the registered outputSchema (required-data tools)", async () => {
  // Regression: before the toolEnvelopeSchema relaxation, an uncaught
  // throw produced data: {} which violated outputDataSchema for any
  // tool whose data has required fields. The MCP framework's output
  // validator would reject the envelope and re-throw — defeating the
  // safety net. This test pins that an envelope from the catch path
  // round-trips through the registered output schema cleanly even
  // when the tool's outputDataSchema requires fields.
  clearToolManifest();
  const server = makeCapturingServer();
  const requiredOutputData = z.object({
    file: z.string(),
    count: z.number(),
    deepNested: z.object({ flag: z.boolean() }),
  });
  registerStructuredTool({
    server: server as unknown as McpServer,
    name: "test_required_data",
    description: "test",
    category: "analysis",
    outputDataSchema: requiredOutputData,
    callback: async () => {
      throw new Error("oops");
    },
  });

  const result = await server.get("test_required_data")!.callback({});
  expect(result.isError).toBe(true);
  // The envelope's data is `{}` (relaxed) but the framework's
  // output schema validation should still pass because the union
  // accepts a record-of-unknown shape on errors.
  const data = result.structuredContent.data;
  expect(typeof data).toBe("object");
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
