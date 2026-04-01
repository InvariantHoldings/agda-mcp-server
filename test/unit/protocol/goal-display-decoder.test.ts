import { test, expect } from "vitest";

import { decodeGoalDisplayResponses } from "../../../src/protocol/responses/goal-display.js";

test("decodeGoalDisplayResponses decodes explicit context entries", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "Context",
        context: [
          { reifiedName: "x", binding: "Nat" },
          { originalName: "p", binding: "x ≡ x" },
        ],
      },
    },
  ]);

  expect(decoded.context).toEqual(["x : Nat", "p : x ≡ x"]);
  expect(decoded.goalType).toBe("");
  expect(decoded.auxiliary).toBe("");
});

test("decodeGoalDisplayResponses splits sectioned goal displays", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "GoalSpecific",
        goalInfo: {
          message: "x : Nat\np : x ≡ x\n————\nx ≡ x\n————\nrefl",
        },
      },
    },
  ]);

  expect(decoded.context).toEqual(["x : Nat", "p : x ≡ x"]);
  expect(decoded.goalType).toBe("x ≡ x");
  expect(decoded.auxiliary).toBe("refl");
});

test("decodeGoalDisplayResponses handles context with missing names", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "Context",
        context: [
          { binding: "Nat" },
          { reifiedName: null, originalName: null, binding: "Bool" },
        ],
      },
    },
  ]);
  // No name fields → falls back to "_"
  expect(decoded.context[0]).toBe("_ : Nat");
  expect(decoded.context[1]).toBe("_ : Bool");
});

test("decodeGoalDisplayResponses handles empty context array", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "Context", context: [] },
    },
  ]);
  expect(decoded.context).toEqual([]);
});

test("decodeGoalDisplayResponses handles GoalSpecific without goalInfo", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "GoalSpecific" },
    },
  ]);
  expect(decoded.goalType).toBe("");
});

test("decodeGoalDisplayResponses handles GoalType kind directly", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "GoalType", message: "Nat → Bool" },
    },
  ]);
  expect(decoded.goalType).toBe("Nat → Bool");
});

test("decodeGoalDisplayResponses ignores non-DisplayInfo responses", () => {
  const decoded = decodeGoalDisplayResponses([
    { kind: "Status", checked: true },
    { kind: "RunningInfo", message: "checking" },
  ]);
  expect(decoded.goalType).toBe("");
  expect(decoded.context).toEqual([]);
});
