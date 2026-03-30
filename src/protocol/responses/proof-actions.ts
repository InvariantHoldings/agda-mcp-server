import type { AgdaResponse } from "../../agda/types.js";
import {
  displayInfoResponseSchema,
  giveActionResponseSchema,
  makeCaseResponseSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

export function decodeGiveLikeResponse(responses: AgdaResponse[]): string {
  let result = "";
  const displayMessages = decodeDisplayInfoEvents(responses)
    .map((event) => event.text)
    .filter(Boolean);

  for (const resp of responses) {
    const give = parseResponseWithSchema(giveActionResponseSchema, resp);
    if (give) {
      const val = give.giveResult ?? give.result ?? "";
      if (val) result = val;
      continue;
    }

    if (parseResponseWithSchema(displayInfoResponseSchema, resp)) {
      continue;
    }
  }

  return result || displayMessages.at(-1) || "";
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

    if (parseResponseWithSchema(displayInfoResponseSchema, resp)) {
      continue;
    }
  }

  if (solutions.length === 0) {
    solutions.push(
      ...decodeDisplayInfoEvents(responses)
        .map((event) => event.text)
        .filter(Boolean),
    );
  }

  return solutions;
}

export function decodeCaseSplitResponses(responses: AgdaResponse[]): string[] {
  const clauses: string[] = [];

  for (const response of responses) {
    const makeCase = parseResponseWithSchema(makeCaseResponseSchema, response);
    if (!makeCase) {
      continue;
    }

    clauses.push(...(makeCase.clauses ?? []).filter(Boolean));
  }

  if (clauses.length > 0) {
    return clauses;
  }

  return decodeDisplayInfoEvents(responses)
    .map((event) => event.text)
    .filter(Boolean);
}
