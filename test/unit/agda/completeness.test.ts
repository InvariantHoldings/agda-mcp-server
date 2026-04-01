import { test, expect } from "vitest";

import {
  classifyCompleteness,
  completenessFromLoadResult,
  completenessFromTypeCheckResult,
} from "../../../src/agda/completeness.js";

test("classifyCompleteness marks successful goal-free results as complete", () => {
  const result = classifyCompleteness({
    success: true,
    goals: [],
    invisibleGoalCount: 0,
  });

  expect(result).toEqual({
    classification: "ok-complete",
    goalCount: 0,
    invisibleGoalCount: 0,
    hasHoles: false,
    isComplete: true,
  });
});

test("classifyCompleteness marks visible or invisible goals as incomplete", () => {
  const visible = classifyCompleteness({
    success: true,
    goals: [{}],
    invisibleGoalCount: 0,
  });
  const invisible = classifyCompleteness({
    success: true,
    goals: [],
    invisibleGoalCount: 2,
  });

  expect(visible.classification).toBe("ok-with-holes");
  expect(visible.hasHoles).toBe(true);
  expect(visible.isComplete).toBe(false);
  expect(invisible.classification).toBe("ok-with-holes");
  expect(invisible.goalCount).toBe(0);
  expect(invisible.invisibleGoalCount).toBe(2);
});

test("completeness helpers preserve load/typecheck semantics", () => {
  const loadStatus = completenessFromLoadResult({
    success: false,
    errors: ["type error"],
    warnings: [],
    goals: [],
    allGoalsText: "",
    invisibleGoalCount: 0,
    goalCount: 0,
    hasHoles: false,
    isComplete: false,
    classification: "type-error",
  });
  const typecheckStatus = completenessFromTypeCheckResult({
    success: true,
    errors: [],
    warnings: [],
    goals: [{ goalId: 1, type: "Nat", context: [] }],
    invisibleGoalCount: 0,
    goalCount: 1,
    hasHoles: true,
    isComplete: false,
    classification: "ok-with-holes",
  });

  expect(loadStatus.classification).toBe("type-error");
  expect(typecheckStatus.classification).toBe("ok-with-holes");
});
