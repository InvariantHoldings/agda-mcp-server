import type { AgdaResponse } from "../agda/types.js";
import { decodeDisplayInfoEvents } from "../protocol/responses/display-info.js";
import { decodeLoadDisplayResponses } from "../protocol/responses/load-display.js";
import { decodeInteractionPointIds } from "../protocol/responses/process-output.js";

export function extractGoalIdsFromResponses(
  responses: AgdaResponse[],
): number[] | null {
  const interactionPointIds = decodeInteractionPointIds(responses);
  const sawInteractionPoints = responses.some((response) => response.kind === "InteractionPoints");
  const loadDisplay = decodeLoadDisplayResponses(responses);
  const sawGoalEvidence = sawInteractionPoints
    || decodeDisplayInfoEvents(responses).some((event) => event.infoKind === "AllGoalsWarnings");

  if (!sawGoalEvidence) {
    return null;
  }

  const goalIds: number[] = [];
  const seen = new Set<number>();

  for (const goalId of interactionPointIds) {
    if (!seen.has(goalId)) {
      seen.add(goalId);
      goalIds.push(goalId);
    }
  }

  for (const goal of loadDisplay.visibleGoals) {
    if (!seen.has(goal.goalId)) {
      seen.add(goal.goalId);
      goalIds.push(goal.goalId);
    }
  }

  return goalIds;
}
