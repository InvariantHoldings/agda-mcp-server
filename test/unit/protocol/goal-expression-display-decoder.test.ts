import { test, expect } from "vitest";

import { decodeGoalExpressionDisplayResponses } from "../../../src/protocol/responses/goal-expression-display.js";

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

  expect(decoded.goalType).toBe("Nat");
  expect(decoded.context).toEqual(["n : Nat", "m : Nat"]);
  expect(decoded.inferredType).toBe("Nat");
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

  expect(decoded.goalType).toBe("Nat");
  expect(decoded.inferredType).toBe("zero");
  expect(decoded.checkedExpr).toBe("zero");
});

test("decodeGoalExpressionDisplayResponses reads GoalType.typeAux expr", () => {
  const decoded = decodeGoalExpressionDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          kind: "GoalType",
          type: "Nat",
          entries: [
            { reifiedName: "n", binding: "Nat" },
            { reifiedName: "m", binding: "Nat" },
          ],
          typeAux: {
            kind: "GoalAndHave",
            expr: "Nat",
          },
        },
      },
    },
  ]);

  expect(decoded.goalType).toBe("Nat");
  expect(decoded.inferredType).toBe("Nat");
  expect(decoded.checkedExpr).toBe("Nat");
});

test("decodeGoalExpressionDisplayResponses reads GoalType.typeAux term", () => {
  const decoded = decodeGoalExpressionDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          kind: "GoalType",
          type: "Nat",
          entries: [
            { reifiedName: "n", binding: "Nat" },
            { reifiedName: "m", binding: "Nat" },
          ],
          typeAux: {
            kind: "GoalAndElaboration",
            term: "zero",
          },
        },
      },
    },
  ]);

  expect(decoded.goalType).toBe("Nat");
  expect(decoded.inferredType).toBe("zero");
  expect(decoded.checkedExpr).toBe("zero");
});
