import { test, expect } from "vitest";

import { decodeExpressionDisplayResponses } from "../../../src/protocol/responses/expression-display.js";

test("decodeExpressionDisplayResponses extracts normal forms and inferred types", () => {
  const decoded = decodeExpressionDisplayResponses([
    { kind: "DisplayInfo", info: { kind: "NormalForm", expr: "suc zero" } },
    { kind: "DisplayInfo", info: { kind: "InferredType", type: "Nat" } },
  ]);

  expect(decoded.normalForm).toBe("suc zero");
  expect(decoded.inferredType).toBe("Nat");
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

  expect(decoded.inferredType).toBe("Nat -> Nat");
  expect(decoded.normalForm).toBe("");
});
