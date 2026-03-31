import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCompleteness,
  completenessFromLoadResult,
  completenessFromTypeCheckResult,
} from "../../../dist/agda/completeness.js";

test("classifyCompleteness marks successful goal-free results as complete", () => {
  const result = classifyCompleteness({
    success: true,
    goals: [],
    invisibleGoalCount: 0,
  });

  assert.deepEqual(result, {
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

  assert.equal(visible.classification, "ok-with-holes");
  assert.equal(visible.hasHoles, true);
  assert.equal(visible.isComplete, false);
  assert.equal(invisible.classification, "ok-with-holes");
  assert.equal(invisible.goalCount, 0);
  assert.equal(invisible.invisibleGoalCount, 2);
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

  assert.equal(loadStatus.classification, "type-error");
  assert.equal(typecheckStatus.classification, "ok-with-holes");
});
