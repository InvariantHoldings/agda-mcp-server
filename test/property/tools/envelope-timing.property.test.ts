import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  okEnvelope,
  errorEnvelope,
  makeToolResult,
} from "../../../src/tools/tool-helpers.js";

// ── Property: okEnvelope with elapsedMs always produces non-negative number ──

test("okEnvelope always preserves elapsedMs when provided as non-negative integer", async () => {
  await fc.assert(
    fc.property(
      fc.nat({ max: 1_000_000 }),
      fc.string({ minLength: 1 }),
      (ms, tool) => {
        const env = okEnvelope({
          tool,
          summary: "ok",
          data: { text: "test" },
          elapsedMs: ms,
        });
        expect(env.elapsedMs).toBe(ms);
        expect(env.ok).toBe(true);
      },
    ),
  );
});

// ── Property: okEnvelope without elapsedMs has undefined ─────────────

test("okEnvelope without elapsedMs always has undefined elapsedMs", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.string(),
      (tool, summary) => {
        const env = okEnvelope({
          tool,
          summary,
          data: {},
        });
        expect(env.elapsedMs).toBeUndefined();
      },
    ),
  );
});

// ── Property: errorEnvelope never has elapsedMs ─────────────────────

test("errorEnvelope never produces elapsedMs", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.string(),
      (tool, summary) => {
        const env = errorEnvelope({
          tool,
          summary,
          data: { text: "error" },
        });
        expect(env.elapsedMs).toBeUndefined();
        expect(env.ok).toBe(false);
      },
    ),
  );
});

// ── Property: makeToolResult preserves elapsedMs from envelope ───────

test("makeToolResult always preserves elapsedMs from okEnvelope", async () => {
  await fc.assert(
    fc.property(
      fc.nat({ max: 1_000_000 }),
      (ms) => {
        const env = okEnvelope({
          tool: "test",
          summary: "ok",
          data: {},
          elapsedMs: ms,
        });
        const result = makeToolResult(env);
        expect(result.structuredContent.elapsedMs).toBe(ms);
      },
    ),
  );
});

// ── Property: makeToolResult from errorEnvelope has no elapsedMs ─────

test("makeToolResult from errorEnvelope never has elapsedMs", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (tool) => {
        const env = errorEnvelope({
          tool,
          summary: "error",
          data: {},
        });
        const result = makeToolResult(env);
        expect(result.structuredContent.elapsedMs).toBeUndefined();
      },
    ),
  );
});

// ── Property: classification is always defined ──────────────────────

test("okEnvelope classification defaults to 'ok' when not specified", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (tool) => {
        const env = okEnvelope({ tool, summary: "ok", data: {} });
        expect(env.classification).toBe("ok");
      },
    ),
  );
});

test("errorEnvelope classification defaults to 'tool-error' when not specified", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (tool) => {
        const env = errorEnvelope({ tool, summary: "error", data: {} });
        expect(env.classification).toBe("tool-error");
      },
    ),
  );
});

// ── Property: envelope data is always preserved through makeToolResult ──

test("makeToolResult always preserves all data keys from envelope", async () => {
  await fc.assert(
    fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string(), {
        minKeys: 0,
        maxKeys: 10,
      }),
      (data) => {
        const env = okEnvelope({
          tool: "test",
          summary: "ok",
          data,
        });
        const result = makeToolResult(env);
        for (const key of Object.keys(data)) {
          expect(result.structuredContent.data[key]).toBe(data[key]);
        }
      },
    ),
  );
});

// ── Property: elapsedMs schema rejects invalid values ───────────────

test("envelopeBaseSchema rejects negative elapsedMs", async () => {
  const { toolEnvelopeSchema } = await import("../../../src/tools/tool-helpers.js");
  const { z } = await import("zod");
  const schema = toolEnvelopeSchema(z.object({ text: z.string() }));

  await fc.assert(
    fc.property(
      fc.integer({ min: -1_000_000, max: -1 }),
      (negativeMs) => {
        const result = schema.safeParse({
          tool: "test",
          ok: true,
          classification: "ok",
          summary: "ok",
          data: { text: "hello" },
          diagnostics: [],
          elapsedMs: negativeMs,
        });
        expect(result.success).toBe(false);
      },
    ),
  );
});

test("envelopeBaseSchema rejects non-integer elapsedMs", async () => {
  const { toolEnvelopeSchema } = await import("../../../src/tools/tool-helpers.js");
  const { z } = await import("zod");
  const schema = toolEnvelopeSchema(z.object({ text: z.string() }));

  await fc.assert(
    fc.property(
      fc.double({ min: 0.001, max: 1_000_000, noNaN: true }),
      (floatMs) => {
        // Only test non-integers
        if (Number.isInteger(floatMs)) return;
        const result = schema.safeParse({
          tool: "test",
          ok: true,
          classification: "ok",
          summary: "ok",
          data: { text: "hello" },
          diagnostics: [],
          elapsedMs: floatMs,
        });
        expect(result.success).toBe(false);
      },
    ),
  );
});

test("envelopeBaseSchema accepts non-negative integer elapsedMs", async () => {
  const { toolEnvelopeSchema } = await import("../../../src/tools/tool-helpers.js");
  const { z } = await import("zod");
  const schema = toolEnvelopeSchema(z.object({ text: z.string() }));

  await fc.assert(
    fc.property(
      fc.nat({ max: 10_000_000 }),
      (ms) => {
        const result = schema.safeParse({
          tool: "test",
          ok: true,
          classification: "ok",
          summary: "ok",
          data: { text: "hello" },
          diagnostics: [],
          elapsedMs: ms,
        });
        expect(result.success).toBe(true);
      },
    ),
  );
});

test("envelopeBaseSchema accepts missing elapsedMs", async () => {
  const { toolEnvelopeSchema } = await import("../../../src/tools/tool-helpers.js");
  const { z } = await import("zod");
  const schema = toolEnvelopeSchema(z.object({ text: z.string() }));

  const result = schema.safeParse({
    tool: "test",
    ok: true,
    classification: "ok",
    summary: "ok",
    data: { text: "hello" },
    diagnostics: [],
  });
  expect(result.success).toBe(true);
});
