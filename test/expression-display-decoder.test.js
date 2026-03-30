import test from "node:test";
import assert from "node:assert/strict";

import { decodeExpressionDisplayResponses } from "../dist/protocol/responses/expression-display.js";

test("decodeExpressionDisplayResponses extracts normal forms and inferred types", () => {
  const decoded = decodeExpressionDisplayResponses([
    { kind: "DisplayInfo", info: { kind: "NormalForm", expr: "suc zero" } },
    { kind: "DisplayInfo", info: { kind: "InferredType", type: "Nat" } },
  ]);

  assert.equal(decoded.normalForm, "suc zero");
  assert.equal(decoded.inferredType, "Nat");
});

test("decodeExpressionDisplayResponses unwraps GoalSpecific structured payloads", () => {
  const decoded = decodeExpressionDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: { kind: "InferredType", message: "Nat -> Nat" },
      },
    },
  ]);

  assert.equal(decoded.inferredType, "Nat -> Nat");
  assert.equal(decoded.normalForm, "");
});
