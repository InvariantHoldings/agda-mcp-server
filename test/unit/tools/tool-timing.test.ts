import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  okEnvelope,
  errorEnvelope,
  makeToolResult,
} from "../../../src/tools/tool-helpers.js";

// ── okEnvelope elapsedMs handling ────────────────────────────────────

test("okEnvelope includes elapsedMs when provided", () => {
  const envelope = okEnvelope({
    tool: "test_tool",
    summary: "ok",
    data: { text: "hello" },
    elapsedMs: 42,
  });
  expect(envelope.elapsedMs).toBe(42);
});

test("okEnvelope has undefined elapsedMs when not provided", () => {
  const envelope = okEnvelope({
    tool: "test_tool",
    summary: "ok",
    data: { text: "hello" },
  });
  expect(envelope.elapsedMs).toBeUndefined();
});

// ── Property: elapsedMs is always non-negative when set ──────────────

test("elapsedMs is always non-negative when provided", async () => {
  await fc.assert(
    fc.property(
      fc.nat(),
      (ms) => {
        const envelope = okEnvelope({
          tool: "test",
          summary: "ok",
          data: {},
          elapsedMs: ms,
        });
        expect(envelope.elapsedMs).toBeGreaterThanOrEqual(0);
      },
    ),
  );
});

// ── makeToolResult preserves elapsedMs from envelope ─────────────────

test("makeToolResult preserves elapsedMs in structuredContent", () => {
  const envelope = okEnvelope({
    tool: "test_tool",
    summary: "done",
    data: { text: "result" },
    elapsedMs: 100,
  });
  const result = makeToolResult(envelope);
  expect(result.structuredContent.elapsedMs).toBe(100);
});

test("makeToolResult has no elapsedMs when envelope does not have it", () => {
  const envelope = okEnvelope({
    tool: "test_tool",
    summary: "done",
    data: { text: "result" },
  });
  const result = makeToolResult(envelope);
  expect(result.structuredContent.elapsedMs).toBeUndefined();
});

// ── errorEnvelope does not have elapsedMs (errors don't get timing) ──

test("errorEnvelope does not include elapsedMs", () => {
  const envelope = errorEnvelope({
    tool: "test_tool",
    summary: "failed",
    data: { text: "error" },
  });
  expect(envelope.elapsedMs).toBeUndefined();
});
