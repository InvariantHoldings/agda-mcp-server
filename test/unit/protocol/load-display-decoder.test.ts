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
        // IOTCM sends NamedMeta: { name: string, range: Range }
        invisibleGoals: [{ constraintObj: { name: "_4", range: [] }, type: "Hidden" }],
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
  expect(decoded.invisibleGoals).toEqual([{ name: "_4", type: "Hidden" }]);
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

test("decodeLoadDisplayResponses preserves the largest invisible-goal set across multiple AllGoalsWarnings events", () => {
  const decoded = decodeLoadDisplayResponses([
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        // IOTCM NamedMeta entries: { name: string, range: Range }
        invisibleGoals: [
          { constraintObj: { name: "_4", range: [] }, type: "Hidden₁" },
          { constraintObj: { name: "_5", range: [] }, type: "Hidden₂" },
        ],
        errors: [],
        warnings: [],
      },
    },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);

  expect(decoded.invisibleGoalCount).toBe(2);
  expect(decoded.invisibleGoals).toEqual([
    { name: "_4", type: "Hidden₁" },
    { name: "_5", type: "Hidden₂" },
  ]);
});
