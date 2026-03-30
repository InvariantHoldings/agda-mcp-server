import type { AgdaResponse } from "../../agda/types.js";
import { decodeExpressionDisplayResponses } from "./expression-display.js";
import { decodeGoalDisplayResponses } from "./goal-display.js";

export interface DecodedGoalExpressionDisplay {
  goalType: string;
  context: string[];
  inferredType: string;
  checkedExpr: string;
}

export function decodeGoalExpressionDisplayResponses(
  responses: AgdaResponse[],
): DecodedGoalExpressionDisplay {
  const goal = decodeGoalDisplayResponses(responses);
  const expression = decodeExpressionDisplayResponses(responses);

  return {
    goalType: goal.goalType,
    context: goal.context,
    inferredType: expression.inferredType || goal.auxiliary,
    checkedExpr: expression.normalForm || goal.auxiliary,
  };
}
