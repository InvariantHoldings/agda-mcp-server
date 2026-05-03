// MIT License — see LICENSE
//
// Batch hole-replacement applicator. Used by `agda_solve_all` to
// apply many `goalId → expression` substitutions to a single file
// in one atomic write — the alternative (per-goal applies) would
// invalidate offsets on every step and force costly re-scans.

import { findGoalPositions } from "./goal-positions.js";
import {
  MAX_AGDA_SOURCE_BYTES,
  loadSourceForEdit,
  writeFileAtomic,
} from "./safe-source-io.js";

export interface BatchApplyResult {
  appliedCount: number;
  failedGoalIds: number[];
  /**
   * Goal IDs that appeared more than once in `replacements` — later
   * occurrences are kept and earlier ones discarded. See the
   * `applyBatchHoleReplacements` docstring for rationale.
   */
  droppedDuplicateGoalIds: number[];
  message: string;
}

/**
 * Apply multiple hole replacements to an Agda source file in one pass.
 *
 * Replacements are applied back-to-front (reverse offset order) so that
 * earlier offsets remain valid after each substitution.
 *
 * Duplicate `goalId`s in `replacements` are handled with a "last wins"
 * rule: the most recently supplied replacement for a given goalId is
 * the one applied, earlier ones are discarded. Agda's SolveAll/SolveOne
 * never emits duplicates, so this branch is defensive — but "last
 * wins" matches the intuition that successive calls should override,
 * and we track the discard count in `droppedDuplicateGoalIds` so
 * agents can notice when their caller-side bug is silently eating
 * work.
 *
 * Returns applied count, goal IDs that couldn't be located, dropped
 * duplicate goal IDs, and a human-readable summary.
 */
export async function applyBatchHoleReplacements(
  filePath: string,
  goalIds: number[],
  replacements: Array<{ goalId: number; expr: string }>,
): Promise<BatchApplyResult> {
  const loadResult = await loadSourceForEdit(filePath);
  if (!loadResult.ok) {
    return {
      appliedCount: 0,
      failedGoalIds: [],
      droppedDuplicateGoalIds: [],
      message: `Could not read file (${loadResult.code}): ${loadResult.message}`,
    };
  }
  const source = loadResult.source;
  const allPositions = findGoalPositions(source);

  // Build goalId → positional index map once (O(n)), so the loop
  // below is O(m) instead of O(n*m).
  const goalIdToIndex = new Map<number, number>();
  for (let i = 0; i < goalIds.length; i++) {
    goalIdToIndex.set(goalIds[i], i);
  }

  // Last-wins deduplication: walk replacements in order and record
  // the final expression for each goalId. Earlier duplicates go into
  // droppedDuplicateGoalIds so we can surface them in the message.
  const lastByGoalId = new Map<number, string>();
  const droppedDuplicateGoalIds: number[] = [];
  for (const { goalId, expr } of replacements) {
    if (lastByGoalId.has(goalId)) {
      droppedDuplicateGoalIds.push(goalId);
    }
    lastByGoalId.set(goalId, expr);
  }

  const edits: Array<{ start: number; end: number; expr: string; goalId: number }> = [];
  const failedGoalIds: number[] = [];

  for (const [goalId, expr] of lastByGoalId) {
    const index = goalIdToIndex.get(goalId);
    if (index === undefined || index >= allPositions.length) {
      failedGoalIds.push(goalId);
      continue;
    }
    const pos = allPositions[index];
    edits.push({ start: pos.startOffset, end: pos.endOffset, expr, goalId });
  }

  const dupMsg =
    droppedDuplicateGoalIds.length > 0
      ? ` (dropped ${droppedDuplicateGoalIds.length} duplicate goalId entr${droppedDuplicateGoalIds.length === 1 ? "y" : "ies"}; last-wins)`
      : "";

  if (edits.length === 0) {
    return {
      appliedCount: 0,
      failedGoalIds,
      droppedDuplicateGoalIds,
      message:
        failedGoalIds.length > 0
          ? `Could not locate goals ${failedGoalIds.map((id) => `?${id}`).join(", ")} in file — the file may have been modified since last load.${dupMsg}`
          : `No replacements to apply.${dupMsg}`,
    };
  }

  // Apply in reverse offset order: modifying later positions first keeps
  // earlier offsets valid for subsequent replacements.
  edits.sort((a, b) => b.start - a.start);

  let newSource = source;
  for (const edit of edits) {
    newSource = newSource.slice(0, edit.start) + edit.expr + newSource.slice(edit.end);
  }

  // Same post-edit cap as applyTextEdit / applyProofEdit: many
  // large solutions could inflate the file past the cap even if
  // individual ones are innocuous.
  if (Buffer.byteLength(newSource, "utf-8") > MAX_AGDA_SOURCE_BYTES) {
    return {
      appliedCount: 0,
      failedGoalIds,
      droppedDuplicateGoalIds,
      message:
        `Batch edit result exceeds the ${MAX_AGDA_SOURCE_BYTES}-byte ` +
        `Agda-source cap; refusing to write. Shrink the solutions or ` +
        `apply them one at a time.${dupMsg}`,
    };
  }

  await writeFileAtomic(filePath, newSource);

  const failedMsg =
    failedGoalIds.length > 0
      ? ` (could not locate ${failedGoalIds.map((id) => `?${id}`).join(", ")})`
      : "";
  return {
    appliedCount: edits.length,
    failedGoalIds,
    droppedDuplicateGoalIds,
    message: `Applied ${edits.length} solution(s) to file${failedMsg}${dupMsg}.`,
  };
}
