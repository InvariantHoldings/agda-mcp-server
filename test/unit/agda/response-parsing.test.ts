import { test, expect } from "vitest";

import {
  extractMessage,
  escapeAgdaString,
} from "../../../src/agda-process.js";

test("extractMessage prefers direct string fields", () => {
  expect(extractMessage({ message: "hello" })).toBe("hello");
  expect(extractMessage({ payload: "fallback" })).toBe("fallback");
});

test("extractMessage unwraps nested goal info and goal warnings", () => {
  expect(
    extractMessage({
      goalInfo: { text: "goal text" },
    }),
  ).toBe("goal text");

  expect(
    extractMessage({
      visibleGoals: "visible",
      invisibleGoals: "hidden",
      warnings: "warning",
    }),
  ).toBe("visible\n\nhidden\n\nwarning");
});

test("extractMessage handles AllGoalsWarnings with array fields", () => {
  const result = extractMessage({
    visibleGoals: [{ type: "?0 : Nat" }, { type: "?1 : Bool" }],
    invisibleGoals: [],
    warnings: [],
    errors: [{ message: "type mismatch" }],
  });
  expect(result.includes("Nat")).toBeTruthy();
  expect(result.includes("Bool")).toBeTruthy();
  expect(result.includes("type mismatch")).toBeTruthy();
});

test("extractMessage handles AllGoalsWarnings with mixed string and array", () => {
  const result = extractMessage({
    visibleGoals: "?0 : Nat",
    invisibleGoals: [{ type: "?1 : hidden" }],
    warnings: [],
    errors: [],
  });
  expect(result.includes("Nat")).toBeTruthy();
  expect(result.includes("hidden")).toBeTruthy();
});

test("escapeAgdaString escapes backslashes, quotes, and newlines", () => {
  const input = 'line1\\path "quoted"\nline2';

  expect(
    escapeAgdaString(input),
  ).toBe(
    'line1\\\\path \\"quoted\\"\\nline2',
  );
});
