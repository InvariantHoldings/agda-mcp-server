import type { AgdaResponse } from "../../agda/types.js";
import {
  inferredTypeInfoSchema,
  normalFormInfoSchema,
  parseResponseWithSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

export interface DecodedExpressionDisplay {
  normalForm: string;
  inferredType: string;
}

export function decodeExpressionDisplayResponses(
  responses: AgdaResponse[],
): DecodedExpressionDisplay {
  let normalForm = "";
  let inferredType = "";

  for (const event of decodeDisplayInfoEvents(responses)) {
    const normalFormInfo = parseResponseWithSchema(normalFormInfoSchema, event.payload);
    if (normalFormInfo) {
      normalForm =
        normalFormInfo.expr
        ?? normalFormInfo.normalForm
        ?? normalFormInfo.message
        ?? event.text;
      continue;
    }

    const inferredTypeInfo = parseResponseWithSchema(inferredTypeInfoSchema, event.payload);
    if (inferredTypeInfo) {
      inferredType =
        inferredTypeInfo.type
        ?? inferredTypeInfo.expr
        ?? inferredTypeInfo.message
        ?? event.text;
    }
  }

  return { normalForm, inferredType };
}
