// MIT License — see LICENSE
//
// Pure helper for merging two ordered goal lists into one canonical
// list. Used by session.load() to reconcile the goals extracted
// directly from Cmd_load's AllGoalsWarnings payload with the richer
// goal-type / context information that the follow-up Cmd_metas call
// returns. The secondary goals fill in missing types and contexts on
// goals already present in the primary list; new secondary goals are
// appended. The output is sorted by goalId so downstream consumers
// can assume a stable ordering.

import type { AgdaGoal } from "./types.js";

export function mergeGoals(
  primaryGoals: AgdaGoal[],
  secondaryGoals: AgdaGoal[],
): AgdaGoal[] {
  const merged = new Map<number, AgdaGoal>();

  for (const goal of primaryGoals) {
    merged.set(goal.goalId, { ...goal, context: [...goal.context] });
  }

  for (const goal of secondaryGoals) {
    const existing = merged.get(goal.goalId);
    if (!existing) {
      merged.set(goal.goalId, { ...goal, context: [...goal.context] });
      continue;
    }

    if (existing.type === "?" && goal.type !== "?") {
      existing.type = goal.type;
    }

    if (existing.context.length === 0 && goal.context.length > 0) {
      existing.context = [...goal.context];
    }
  }

  return [...merged.values()].sort((left, right) => left.goalId - right.goalId);
}
