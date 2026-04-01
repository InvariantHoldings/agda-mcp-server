import { test, expect } from "vitest";

import { decodeLoadDisplayResponses } from "../../../src/protocol/responses/load-display.js";

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

  expect(decoded.visibleGoals).toEqual([
    { goalId: 2, type: "Nat" },
    { goalId: 3, type: "Bool" },
  ]);
  expect(decoded.invisibleGoalCount).toBe(1);
  expect(decoded.errors).toEqual(["type mismatch"]);
  expect(decoded.warnings).toEqual(["unreachable clause"]);
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

  expect(decoded.visibleGoals).toEqual([{ goalId: 7, type: "Nat" }]);
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

  expect(decoded.visibleGoals).toEqual([{ goalId: 9, type: "Nat" }]);
});
