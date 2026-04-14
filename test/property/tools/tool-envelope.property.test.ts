// MIT License — see LICENSE
//
// Property-based tests for tool envelope invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  okEnvelope,
  errorEnvelope,
  makeToolResult,
  infoDiagnostic,
  warningDiagnostic,
  errorDiagnostic,
  type ToolDiagnostic,
} from "../../../src/tools/tool-envelope.js";

// ── Generators ──────────────────────────────────────────────────────

const arbTool = fc.string({ minLength: 1, maxLength: 30 });
const arbSummary = fc.string({ minLength: 0, maxLength: 100 });
const arbClassification = fc.string({ minLength: 1, maxLength: 20 });

const arbDiagnostic: fc.Arbitrary<ToolDiagnostic> = fc.record({
  severity: fc.constantFrom("error" as const, "warning" as const, "info" as const),
  message: fc.string({ minLength: 1, maxLength: 50 }),
  code: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
});

// ── Properties ──────────────────────────────────────────────────────

test("okEnvelope always has ok: true", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = okEnvelope({
        tool,
        summary,
        data: { text: "test" },
      });
      expect(env.ok).toBe(true);
    }),
  );
});

test("errorEnvelope always has ok: false", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = errorEnvelope({
        tool,
        summary,
        data: { text: "test" },
      });
      expect(env.ok).toBe(false);
    }),
  );
});

test("okEnvelope defaults classification to 'ok'", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = okEnvelope({ tool, summary, data: {} });
      expect(env.classification).toBe("ok");
    }),
  );
});

test("errorEnvelope defaults classification to 'tool-error'", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = errorEnvelope({ tool, summary, data: {} });
      expect(env.classification).toBe("tool-error");
    }),
  );
});

test("okEnvelope defaults diagnostics to empty array", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = okEnvelope({ tool, summary, data: {} });
      expect(env.diagnostics).toEqual([]);
    }),
  );
});

test("errorEnvelope without diagnostics creates one from summary", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, (tool, summary) => {
      const env = errorEnvelope({ tool, summary, data: {} });
      expect(env.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(env.diagnostics[0].severity).toBe("error");
      expect(env.diagnostics[0].message).toBe(summary);
    }),
  );
});

test("errorEnvelope preserves custom diagnostics", async () => {
  await fc.assert(
    fc.property(
      arbTool,
      arbSummary,
      fc.array(arbDiagnostic, { minLength: 1, maxLength: 3 }),
      (tool, summary, diagnostics) => {
        const env = errorEnvelope({ tool, summary, data: {}, diagnostics });
        expect(env.diagnostics).toEqual(diagnostics);
      },
    ),
  );
});

test("makeToolResult isError matches envelope ok field", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, fc.boolean(), (tool, summary, isOk) => {
      const env = isOk
        ? okEnvelope({ tool, summary, data: { text: "" } })
        : errorEnvelope({ tool, summary, data: { text: "" } });
      const result = makeToolResult(env);
      expect(result.isError).toBe(!env.ok);
      expect(result.structuredContent.ok).toBe(env.ok);
    }),
  );
});

test("diagnostic factory functions return correct severity", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 50 }), (msg) => {
      expect(infoDiagnostic(msg).severity).toBe("info");
      expect(warningDiagnostic(msg).severity).toBe("warning");
      expect(errorDiagnostic(msg).severity).toBe("error");
    }),
  );
});

test("envelope always preserves tool and summary fields", async () => {
  await fc.assert(
    fc.property(arbTool, arbSummary, fc.boolean(), (tool, summary, isOk) => {
      const env = isOk
        ? okEnvelope({ tool, summary, data: {} })
        : errorEnvelope({ tool, summary, data: {} });
      expect(env.tool).toBe(tool);
      expect(env.summary).toBe(summary);
    }),
  );
});

test("diagnostic nextAction is preserved when provided", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 30 }),
      (message, code, nextAction) => {
        const diag = errorDiagnostic(message, code, nextAction);
        expect(diag.nextAction).toBe(nextAction);
        expect(diag.code).toBe(code);
        expect(diag.severity).toBe("error");

        const info = infoDiagnostic(message, code, nextAction);
        expect(info.nextAction).toBe(nextAction);
        expect(info.severity).toBe("info");

        const warn = warningDiagnostic(message, code, nextAction);
        expect(warn.nextAction).toBe(nextAction);
        expect(warn.severity).toBe("warning");
      },
    ),
  );
});

test("diagnostics without nextAction leave it undefined", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 50 }), (message) => {
      expect(errorDiagnostic(message).nextAction).toBeUndefined();
      expect(infoDiagnostic(message).nextAction).toBeUndefined();
      expect(warningDiagnostic(message).nextAction).toBeUndefined();
    }),
  );
});
