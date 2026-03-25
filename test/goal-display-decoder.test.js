import test from "node:test";
import assert from "node:assert/strict";

import { decodeGoalDisplayResponses } from "../dist/protocol/responses/goal-display.js";

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

  assert.deepEqual(decoded.context, ["x : Nat", "p : x ≡ x"]);
  assert.equal(decoded.goalType, "");
  assert.equal(decoded.auxiliary, "");
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

  assert.deepEqual(decoded.context, ["x : Nat", "p : x ≡ x"]);
  assert.equal(decoded.goalType, "x ≡ x");
  assert.equal(decoded.auxiliary, "refl");
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
  assert.equal(decoded.context[0], "_ : Nat");
  assert.equal(decoded.context[1], "_ : Bool");
});

test("decodeGoalDisplayResponses handles empty context array", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "Context", context: [] },
    },
  ]);
  assert.deepEqual(decoded.context, []);
});

test("decodeGoalDisplayResponses handles GoalSpecific without goalInfo", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "GoalSpecific" },
    },
  ]);
  assert.equal(decoded.goalType, "");
});

test("decodeGoalDisplayResponses handles GoalType kind directly", () => {
  const decoded = decodeGoalDisplayResponses([
    {
      kind: "DisplayInfo",
      info: { kind: "GoalType", message: "Nat → Bool" },
    },
  ]);
  assert.equal(decoded.goalType, "Nat → Bool");
});

test("decodeGoalDisplayResponses ignores non-DisplayInfo responses", () => {
  const decoded = decodeGoalDisplayResponses([
    { kind: "Status", checked: true },
    { kind: "RunningInfo", message: "checking" },
  ]);
  assert.equal(decoded.goalType, "");
  assert.deepEqual(decoded.context, []);
});
