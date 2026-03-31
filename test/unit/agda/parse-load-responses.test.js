import test from "node:test";
import assert from "node:assert/strict";

import { parseLoadResponses } from "../../../dist/agda/parse-load-responses.js";

// All inputs are pre-normalized (arrays, not strings).

test("clean load — no errors, no goals", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
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
    { kind: "Status", checked: true },
  ]);
  assert.equal(result.success, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.goals, []);
  assert.deepEqual(result.goalIds, []);
  assert.equal(result.invisibleGoalCount, 0);
});

test("load with interaction points → goals populated", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0, 1] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: 0, type: "Nat" },
          { constraintObj: 1, type: "Bool" },
        ],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  assert.equal(result.success, true);
  assert.equal(result.goals.length, 2);
  assert.equal(result.goals[0].goalId, 0);
  assert.equal(result.goals[0].type, "Nat");
  assert.equal(result.goals[1].goalId, 1);
  assert.equal(result.goals[1].type, "Bool");
  assert.deepEqual(result.goalIds, [0, 1]);
});

test("load with type error in DisplayInfo Error → success=false", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: { kind: "Error", message: "Nat !=< Bool" },
    },
  ]);
  assert.equal(result.success, false);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].includes("Nat"));
});

test("load with errors in AllGoalsWarnings.errors → success=false", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: 0, type: "?" }],
        invisibleGoals: [],
        errors: [{ range: {}, message: "Unsolved constraints" }],
        warnings: [],
      },
    },
  ]);
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors[0].includes("Unsolved"));
});

test("warnings extracted from AllGoalsWarnings.warnings", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [{ range: {}, message: "unreachable clause" }],
      },
    },
  ]);
  assert.equal(result.success, true);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings[0].includes("unreachable"));
});

test("visibleGoals cross-fills goals missing from InteractionPoints", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: 5, type: "Nat" }],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].goalId, 5);
  assert.equal(result.goals[0].type, "Nat");
  assert.deepEqual(result.goalIds, [5]);
});

test("invisibleGoals (abstract blocks) tracked", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [{ constraintObj: 3, type: "Nat → Nat" }],
        errors: [],
        warnings: [],
      },
    },
  ]);
  assert.equal(result.invisibleGoalCount, 1);
});

test("stderr error sets success=false", () => {
  const result = parseLoadResponses([
    { kind: "StderrOutput", text: "Fatal Error: cannot find module" },
  ]);
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
});

test("goalIds returned for atomic session assignment", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0, 1] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: 0, type: "Nat" },
          { constraintObj: 1, type: "Bool" },
        ],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  assert.deepEqual(result.goalIds, [0, 1]);
});
