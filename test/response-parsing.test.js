import test from "node:test";
import assert from "node:assert/strict";

import {
  extractMessage,
  escapeAgdaString,
} from "../dist/agda-process.js";

test("extractMessage prefers direct string fields", () => {
  assert.equal(extractMessage({ message: "hello" }), "hello");
  assert.equal(extractMessage({ payload: "fallback" }), "fallback");
});

test("extractMessage unwraps nested goal info and goal warnings", () => {
  assert.equal(
    extractMessage({
      goalInfo: { text: "goal text" },
    }),
    "goal text",
  );

  assert.equal(
    extractMessage({
      visibleGoals: "visible",
      invisibleGoals: "hidden",
      warnings: "warning",
    }),
    "visible\n\nhidden\n\nwarning",
  );
});

test("extractMessage handles AllGoalsWarnings with array fields", () => {
  const result = extractMessage({
    visibleGoals: [{ type: "?0 : Nat" }, { type: "?1 : Bool" }],
    invisibleGoals: [],
    warnings: [],
    errors: [{ message: "type mismatch" }],
  });
  assert.ok(result.includes("Nat"));
  assert.ok(result.includes("Bool"));
  assert.ok(result.includes("type mismatch"));
});

test("extractMessage handles AllGoalsWarnings with mixed string and array", () => {
  const result = extractMessage({
    visibleGoals: "?0 : Nat",
    invisibleGoals: [{ type: "?1 : hidden" }],
    warnings: [],
    errors: [],
  });
  assert.ok(result.includes("Nat"));
  assert.ok(result.includes("hidden"));
});

test("escapeAgdaString escapes backslashes, quotes, and newlines", () => {
  const input = 'line1\\path "quoted"\nline2';

  assert.equal(
    escapeAgdaString(input),
    'line1\\\\path \\"quoted\\"\\nline2',
  );
});
