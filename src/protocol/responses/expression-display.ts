import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

export interface DecodedExpressionDisplay {
  normalForm: string;
  inferredType: string;
}

function decodeInfoMessage(info: Record<string, unknown>): string {
  if (typeof info.normalForm === "string") {
    return info.normalForm;
  }

  if (typeof info.type === "string") {
    return info.type;
  }

  if (typeof info.expr === "string") {
    return info.expr;
  }

  return extractMessage(info);
}

export function decodeExpressionDisplayResponses(
  responses: AgdaResponse[],
): DecodedExpressionDisplay {
  let normalForm = "";
  let inferredType = "";

  for (const response of responses) {
    if (response.kind !== "DisplayInfo") {
      continue;
    }

    const info = response.info as Record<string, unknown> | undefined;
    if (!info) {
      continue;
    }

    if (info.kind === "NormalForm") {
      normalForm = decodeInfoMessage(info);
      continue;
    }

    if (info.kind === "InferredType") {
      inferredType = decodeInfoMessage(info);
      continue;
    }

    if (info.kind !== "GoalSpecific") {
      continue;
    }

    const goalInfo = info.goalInfo as Record<string, unknown> | undefined;
    if (!goalInfo) {
      continue;
    }

    if (goalInfo.kind === "NormalForm") {
      normalForm = decodeInfoMessage(goalInfo);
      continue;
    }

    if (goalInfo.kind === "InferredType") {
      inferredType = decodeInfoMessage(goalInfo);
    }
  }

  return { normalForm, inferredType };
}
