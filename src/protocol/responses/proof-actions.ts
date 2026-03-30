import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";
import {
  displayInfoResponseSchema,
  giveActionResponseSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
} from "../response-schemas.js";

export function decodeGiveLikeResponse(responses: AgdaResponse[]): string {
  let result = "";

  for (const resp of responses) {
    const give = parseResponseWithSchema(giveActionResponseSchema, resp);
    if (give) {
      const val = give.giveResult ?? give.result ?? "";
      if (val) result = val;
      continue;
    }

    const display = parseResponseWithSchema(displayInfoResponseSchema, resp);
    if (!display) continue;

    const msg = extractMessage(display.info);
    if (msg && !result) result = msg;
  }

  return result;
}

export function decodeSolveResponses(responses: AgdaResponse[]): string[] {
  const solutions: string[] = [];

  for (const resp of responses) {
    const solveAll = parseResponseWithSchema(solveAllResponseSchema, resp);
    if (solveAll) {
      for (const solution of solveAll.solutions ?? []) {
        if (solution.expression) {
          solutions.push(`?${solution.interactionPoint} := ${solution.expression}`);
        }
      }
      continue;
    }

    const display = parseResponseWithSchema(displayInfoResponseSchema, resp);
    if (!display) continue;

    const msg = extractMessage(display.info);
    if (msg) solutions.push(msg);
  }

  return solutions;
}
