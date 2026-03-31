// MIT License — see LICENSE
//
// Shared completeness semantics for load/typecheck tools.

import type { LoadResult, TypeCheckResult } from "./types.js";

export type CompletenessClassification =
  | "ok-complete"
  | "ok-with-holes"
  | "type-error";

export interface CompletenessStatus {
  classification: CompletenessClassification;
  goalCount: number;
  invisibleGoalCount: number;
  hasHoles: boolean;
  isComplete: boolean;
}

interface CompletenessInput {
  success: boolean;
  goals: Array<unknown>;
  invisibleGoalCount?: number;
}

export function classifyCompleteness(
  input: CompletenessInput,
): CompletenessStatus {
  const goalCount = input.goals.length;
  const invisibleGoalCount = input.invisibleGoalCount ?? 0;
  const hasHoles = goalCount > 0 || invisibleGoalCount > 0;
  const isComplete = input.success && !hasHoles;

  return {
    classification: input.success
      ? hasHoles
        ? "ok-with-holes"
        : "ok-complete"
      : "type-error",
    goalCount,
    invisibleGoalCount,
    hasHoles,
    isComplete,
  };
}

export function completenessFromLoadResult(
  result: LoadResult,
): CompletenessStatus {
  return classifyCompleteness(result);
}

export function completenessFromTypeCheckResult(
  result: TypeCheckResult,
): CompletenessStatus {
  return classifyCompleteness(result);
}
