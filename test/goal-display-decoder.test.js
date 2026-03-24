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
