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

const CLASSIFICATIONS: ReadonlySet<CompletenessClassification> = new Set([
  "ok-complete",
  "ok-with-holes",
  "type-error",
]);

function isCompletenessClassification(
  value: string,
): value is CompletenessClassification {
  return CLASSIFICATIONS.has(value as CompletenessClassification);
}

/**
 * Count-only classification primitive — does no array work and never
 * allocates. Both the public `classifyCompleteness` (which takes a
 * goals array) and the merged-result fallback path call this so they
 * agree by construction and can both stay O(1) regardless of how
 * many goals the caller is reporting.
 */
function classifyFromCounts(
  success: boolean,
  goalCount: number,
  invisibleGoalCount: number,
): CompletenessStatus {
  const hasHoles = goalCount > 0 || invisibleGoalCount > 0;
  const isComplete = success && !hasHoles;
  return {
    classification: success ? (hasHoles ? "ok-with-holes" : "ok-complete") : "type-error",
    goalCount,
    invisibleGoalCount,
    hasHoles,
    isComplete,
  };
}

/**
 * Recompute completeness from the protocol-level counts alone.
 *
 * This is the count-only path: it knows about visible + invisible
 * goals reported by Agda but cannot see source-only hole markers
 * (`{!!}` / `?` / `{! expr !}` inside `abstract` blocks where Agda
 * under-reports invisible goals — see the v0.6.6 bug bundle for
 * `agda_load_no_metas`). Use this for raw protocol shapes; for a
 * `LoadResult` / `TypeCheckResult` that already encodes the merged
 * source+protocol signal, prefer the helpers below so the merged
 * classification round-trips faithfully.
 */
export function classifyCompleteness(
  input: CompletenessInput,
): CompletenessStatus {
  return classifyFromCounts(
    input.success,
    input.goals.length,
    input.invisibleGoalCount ?? 0,
  );
}

interface MergedCompletenessFields {
  success: boolean;
  goalCount: number;
  invisibleGoalCount: number;
  hasHoles: boolean;
  isComplete: boolean;
  classification: string;
}

/**
 * Build a `CompletenessStatus` from a result whose `hasHoles` /
 * `isComplete` / `classification` fields already encode the merged
 * source+protocol signal — i.e. `LoadResult` and `TypeCheckResult`
 * after the load pipeline has fused source-hole scanning with the
 * Agda-reported counts. Honor those fields directly so callers see
 * the same classification the load tool surfaced.
 *
 * Falls back to the count-only `classifyFromCounts` if the embedded
 * `classification` is missing or unknown — defensive for stub results
 * tests construct without populating the merged fields. The fallback
 * is O(1) and never materializes an array; an earlier draft of this
 * helper used `new Array(goalCount)` to round-trip through
 * `classifyCompleteness`, which would have allocated proportionally
 * to a malformed result's reported `goalCount`.
 */
function completenessFromMerged(
  result: MergedCompletenessFields,
): CompletenessStatus {
  if (isCompletenessClassification(result.classification)) {
    return {
      classification: result.classification,
      goalCount: result.goalCount,
      invisibleGoalCount: result.invisibleGoalCount,
      hasHoles: result.hasHoles,
      isComplete: result.isComplete,
    };
  }
  return classifyFromCounts(
    result.success,
    result.goalCount,
    result.invisibleGoalCount,
  );
}

export function completenessFromLoadResult(
  result: LoadResult,
): CompletenessStatus {
  return completenessFromMerged(result);
}

export function completenessFromTypeCheckResult(
  result: TypeCheckResult,
): CompletenessStatus {
  return completenessFromMerged(result);
}
