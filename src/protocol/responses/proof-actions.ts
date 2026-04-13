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
 * True iff `obj` is a non-null object that owns the named property
 * directly (i.e. not inherited from the prototype chain). Used in
 * place of `"key" in obj` when we're testing an untrusted parse
 * result — the `in` operator walks the prototype chain, so a
 * process-wide pollution of `Object.prototype.paren` would fool the
 * original check. `Object.hasOwn` never looks past the object
 * itself.
 */
function hasOwnKey<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && Object.hasOwn(obj, key);
}

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
    if (hasOwnKey(parsed, "paren")) {
      return "Term accepted";
    }
  } catch {
    // Not JSON — use as-is
  }
  return val;
}

/**
 * Guard used by every proof-action tool before writing a result to
 * the source file. A write should only happen when the candidate is
 * a non-null, non-empty string. An empty string would remove the
 * hole marker without replacing it, silently corrupting the source.
 *
 * Unified helper to eliminate drift between give/refine/refine_exact/
 * intro/auto callbacks (each was subtly different — see PR #37
 * audit H4).
 */
export function hasReplacementText(
  candidate: string | null | undefined,
): candidate is string {
  return typeof candidate === "string" && candidate.length > 0;
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
      if (hasOwnKey(parsed, "paren")) {
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

/** Extract structured solutions from SolveAll responses. */
export function decodeSolveRawSolutions(
  responses: AgdaResponse[],
): Array<{ goalId: number; expr: string }> {
  const results: Array<{ goalId: number; expr: string }> = [];
  for (const resp of responses) {
    const solveAll = parseResponseWithSchema(solveAllResponseSchema, resp);
    if (solveAll) {
      for (const solution of solveAll.solutions ?? []) {
        if (solution.expression) {
          results.push({ goalId: solution.interactionPoint, expr: solution.expression });
        }
      }
    }
  }
  return results;
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
