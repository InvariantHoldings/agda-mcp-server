import type { AgdaResponse } from "../../agda/types.js";
import { goalTypeInfoSchema, parseResponseWithSchema } from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";
import { decodeExpressionDisplayResponses } from "./expression-display.js";
import { decodeGoalDisplayResponses } from "./goal-display.js";

export interface DecodedGoalExpressionDisplay {
  goalType: string;
  context: string[];
  inferredType: string;
  checkedExpr: string;
}

function decodeTypeAuxValue(responses: AgdaResponse[]): string {
  for (const event of decodeDisplayInfoEvents(responses)) {
    const goalTypeInfo = parseResponseWithSchema(goalTypeInfoSchema, event.payload);
    if (!goalTypeInfo?.typeAux) {
      continue;
    }

    if (typeof goalTypeInfo.typeAux.expr === "string") {
      return goalTypeInfo.typeAux.expr;
    }

    if (typeof goalTypeInfo.typeAux.term === "string") {
      return goalTypeInfo.typeAux.term;
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
