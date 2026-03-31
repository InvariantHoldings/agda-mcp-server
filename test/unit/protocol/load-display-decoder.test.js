import test from "node:test";
import assert from "node:assert/strict";

import { decodeLoadDisplayResponses } from "../../../dist/protocol/responses/load-display.js";

test("decodeLoadDisplayResponses extracts visible goals, warnings, and errors", () => {
  const decoded = decodeLoadDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: 2, type: "Nat" },
          { constraintObj: 3, type: "Bool" },
        ],
        invisibleGoals: [{ constraintObj: 4, type: "Hidden" }],
        errors: [{ message: "type mismatch" }],
        warnings: [{ message: "unreachable clause" }],
      },
    },
  ]);

  assert.deepEqual(decoded.visibleGoals, [
    { goalId: 2, type: "Nat" },
    { goalId: 3, type: "Bool" },
  ]);
  assert.equal(decoded.invisibleGoalCount, 1);
  assert.deepEqual(decoded.errors, ["type mismatch"]);
  assert.deepEqual(decoded.warnings, ["unreachable clause"]);
});

test("decodeLoadDisplayResponses ignores malformed visible goals", () => {
  const decoded = decodeLoadDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ bad: true }, { constraintObj: 7, type: "Nat" }],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);

  assert.deepEqual(decoded.visibleGoals, [{ goalId: 7, type: "Nat" }]);
});

test("decodeLoadDisplayResponses accepts visible goals with object constraint ids", () => {
  const decoded = decodeLoadDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: { id: 9 }, type: "Nat" },
        ],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);

  assert.deepEqual(decoded.visibleGoals, [{ goalId: 9, type: "Nat" }]);
});
