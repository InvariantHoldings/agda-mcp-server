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

test("escapeAgdaString escapes backslashes, quotes, and newlines", () => {
  const input = 'line1\\path "quoted"\nline2';

  assert.equal(
    escapeAgdaString(input),
    'line1\\\\path \\"quoted\\"\\nline2',
  );
});
