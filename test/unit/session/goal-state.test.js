import test from "node:test";
import assert from "node:assert/strict";

import { extractGoalIdsFromResponses } from "../../../dist/session/goal-state.js";

test("extractGoalIdsFromResponses returns null when no goal-state evidence exists", () => {
  assert.equal(
    extractGoalIdsFromResponses([{ kind: "Status", checked: true }]),
    null,
  );
});

test("extractGoalIdsFromResponses uses interaction points and visible goals", () => {
  assert.deepEqual(
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
    [1, 2],
  );
});

test("extractGoalIdsFromResponses preserves an explicit empty interaction-point update", () => {
  assert.deepEqual(
    extractGoalIdsFromResponses([
      { kind: "InteractionPoints", interactionPoints: [] },
    ]),
    [],
  );
});
