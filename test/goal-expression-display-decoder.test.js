import test from "node:test";
import assert from "node:assert/strict";

import { decodeGoalExpressionDisplayResponses } from "../dist/protocol/responses/goal-expression-display.js";

test("decodeGoalExpressionDisplayResponses combines goal and inferred type payloads", () => {
  const decoded = decodeGoalExpressionDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalType",
        type: "Nat",
        entries: [
          { reifiedName: "n", binding: "Nat" },
          { reifiedName: "m", binding: "Nat" },
        ],
      },
    },
    {
      kind: "DisplayInfo",
      info: {
        kind: "InferredType",
        type: "Nat",
      },
    },
  ]);

  assert.equal(decoded.goalType, "Nat");
  assert.deepEqual(decoded.context, ["n : Nat", "m : Nat"]);
  assert.equal(decoded.inferredType, "Nat");
});

test("decodeGoalExpressionDisplayResponses falls back to goal auxiliary text", () => {
  const decoded = decodeGoalExpressionDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          message: "n : Nat\n————\nNat\n————\nzero",
        },
      },
    },
  ]);

  assert.equal(decoded.goalType, "Nat");
  assert.equal(decoded.inferredType, "zero");
  assert.equal(decoded.checkedExpr, "zero");
});
