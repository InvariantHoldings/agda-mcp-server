import type { AgdaResponse } from "../../agda/types.js";
import {
  displayInfoResponseSchema,
  giveActionResponseSchema,
  makeCaseResponseSchema,
  parseResponseWithSchema,
  solveAllResponseSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

/**
 * Render a GiveResult value as human-readable text.
 *
 * Agda 2.9.0 serializes GiveResult as `{"paren":true}` or `{"paren":false}`.
 * After wire normalization this arrives as the string `'{"paren":false}'`.
 * We detect this pattern and return a meaningful message instead of raw JSON.
 */
function renderGiveResult(val: string): string {
  try {
    const parsed = JSON.parse(val);
    if (parsed && typeof parsed === "object" && "paren" in parsed) {
      return "Term accepted";
    }
  } catch {
    // Not JSON — use as-is
  }
  return val;
}

/**
 * Determine the replacement text for a give-like action.
 *
 * Agda's GiveResult tells us:
 * - Give_String s  → replace the hole with string `s`
 * - Give_Paren     → keep the input expression, parenthesized
 * - Give_NoParen   → keep the input expression as-is
 *
 * Returns the text that should replace the hole in the source file,
 * or null if no GiveAction was found in the responses.
 */
export function resolveGiveReplacementText(
  responses: AgdaResponse[],
  inputExpr: string,
): string | null {
  for (const resp of responses) {
    const give = parseResponseWithSchema(giveActionResponseSchema, resp);
    if (!give) continue;
    const val = give.giveResult ?? give.result ?? "";
    if (!val) return inputExpr;

    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object" && "paren" in parsed) {
        return parsed.paren ? `(${inputExpr})` : inputExpr;
      }
    } catch {
      // Not JSON — treat as Give_String
    }
    // Give_String: Agda returned the actual replacement text
    return val;
  }
  return null;
}

export function decodeGiveLikeResponse(responses: AgdaResponse[]): string {
  let result = "";
  const displayMessages = decodeDisplayInfoEvents(responses)
    .map((event) => event.text)
    .filter(Boolean);

  for (const resp of responses) {
    const give = parseResponseWithSchema(giveActionResponseSchema, resp);
    if (give) {
      const val = give.giveResult ?? give.result ?? "";
      if (val) result = renderGiveResult(val);
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
