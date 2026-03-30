import type { AgdaResponse } from "../../agda/types.js";
import { decodeExpressionDisplayResponses } from "./expression-display.js";
import { decodeGoalDisplayResponses } from "./goal-display.js";

export interface DecodedGoalExpressionDisplay {
  goalType: string;
  context: string[];
  inferredType: string;
  checkedExpr: string;
}

function decodeTypeAuxValue(responses: AgdaResponse[]): string {
  for (const response of responses) {
    if (response.kind !== "DisplayInfo") {
      continue;
    }

    const info = response.info as Record<string, unknown> | undefined;
    if (!info || info.kind !== "GoalSpecific") {
      continue;
    }

    const goalInfo = info.goalInfo as Record<string, unknown> | undefined;
    if (!goalInfo || goalInfo.kind !== "GoalType") {
      continue;
    }

    const typeAux = goalInfo.typeAux as Record<string, unknown> | undefined;
    if (!typeAux) {
      continue;
    }

    if (typeof typeAux.expr === "string") {
      return typeAux.expr;
    }

    if (typeof typeAux.term === "string") {
      return typeAux.term;
    }
  }

  return "";
}

export function decodeGoalExpressionDisplayResponses(
  responses: AgdaResponse[],
): DecodedGoalExpressionDisplay {
  const goal = decodeGoalDisplayResponses(responses);
  const expression = decodeExpressionDisplayResponses(responses);
  const typeAuxValue = decodeTypeAuxValue(responses);

  return {
    goalType: goal.goalType,
    context: goal.context,
    inferredType: expression.inferredType || typeAuxValue || goal.auxiliary,
    checkedExpr: expression.normalForm || typeAuxValue || goal.auxiliary,
  };
}
