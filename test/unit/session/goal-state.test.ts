import { test, expect } from "vitest";

import { extractGoalIdsFromResponses } from "../../../src/session/goal-state.js";

test("extractGoalIdsFromResponses returns null when no goal-state evidence exists", () => {
  expect(
    extractGoalIdsFromResponses([{ kind: "Status", checked: true }]),
  ).toBe(null);
});

test("extractGoalIdsFromResponses uses interaction points and visible goals", () => {
  expect(
    extractGoalIdsFromResponses([
      { kind: "InteractionPoints", interactionPoints: [1] },
      {
        kind: "DisplayInfo",
        info: {
          kind: "AllGoalsWarnings",
          visibleGoals: [
            { constraintObj: { id: 1 }, type: "Nat" },
            { constraintObj: { id: 2 }, type: "Bool" },
          ],
          invisibleGoals: [],
          errors: [],
          warnings: [],
        },
      },
    ]),
  ).toEqual([1, 2]);
});

test("extractGoalIdsFromResponses preserves an explicit empty interaction-point update", () => {
  expect(
    extractGoalIdsFromResponses([
      { kind: "InteractionPoints", interactionPoints: [] },
    ]),
  ).toEqual([]);
});
