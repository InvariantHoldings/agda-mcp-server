import { test, expect } from "vitest";

import { parseLoadResponses } from "../../../src/agda/parse-load-responses.js";

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
  expect(result.success).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.goals).toEqual([]);
  expect(result.goalIds).toEqual([]);
  expect(result.invisibleGoalCount).toBe(0);
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
  expect(result.success).toBe(true);
  expect(result.goals.length).toBe(2);
  expect(result.goals[0].goalId).toBe(0);
  expect(result.goals[0].type).toBe("Nat");
  expect(result.goals[1].goalId).toBe(1);
  expect(result.goals[1].type).toBe("Bool");
  expect(result.goalIds).toEqual([0, 1]);
});

test("load with type error in DisplayInfo Error → success=false", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: { kind: "Error", message: "Nat !=< Bool" },
    },
  ]);
  expect(result.success).toBe(false);
  expect(result.errors.length).toBe(1);
  expect(result.errors[0].includes("Nat")).toBeTruthy();
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
  expect(result.success).toBe(false);
  expect(result.errors.length > 0).toBeTruthy();
  expect(result.errors[0].includes("Unsolved")).toBeTruthy();
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
  expect(result.success).toBe(true);
  expect(result.warnings.length > 0).toBeTruthy();
  expect(result.warnings[0].includes("unreachable")).toBeTruthy();
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
  expect(result.goals.length).toBe(1);
  expect(result.goals[0].goalId).toBe(5);
  expect(result.goals[0].type).toBe("Nat");
  expect(result.goalIds).toEqual([5]);
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
  expect(result.invisibleGoalCount).toBe(1);
});

test("stderr error sets success=false", () => {
  const result = parseLoadResponses([
    { kind: "StderrOutput", text: "Fatal Error: cannot find module" },
  ]);
  expect(result.success).toBe(false);
  expect(result.errors.length > 0).toBeTruthy();
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
  expect(result.goalIds).toEqual([0, 1]);
});
