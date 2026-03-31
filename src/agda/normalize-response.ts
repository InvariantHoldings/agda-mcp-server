// MIT License — see LICENSE
//
// Wire-format normalization for Agda --interaction-json responses.
//
// Agda's JSON protocol has polymorphic fields: some can be strings OR
// arrays of objects depending on version and context. This module
// normalizes all known-polymorphic fields to canonical types immediately
// after JSON.parse, so downstream consumers never deal with the ambiguity.

import type { AgdaResponse } from "./types.js";

/**
 * Coerce a wire value to a string.
 * string → pass-through, array → join elements, other → String().
 */
function toString(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val
      .map((item) =>
        typeof item === "string"
          ? item
          : item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).type === "string"
            ? ((item as Record<string, unknown>).type as string)
            : JSON.stringify(item),
      )
      .join("\n");
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.str === "string") return obj.str;
    if (typeof obj.type === "string") return obj.type;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(val);
  }
  if (val != null) return String(val);
  return "";
}

/**
 * Coerce a wire value to an array.
 * array → pass-through, non-empty string → [string], else → [].
 */
function toArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.trim()) return [val];
  return [];
}

/**
 * Normalize a raw Agda JSON response into canonical form.
 *
 * After normalization:
 * - InteractionPoints.interactionPoints: always number[]
 * - AllGoalsWarnings .visibleGoals/.invisibleGoals/.errors/.warnings: always arrays
 * - GiveAction .giveResult/.result: always string
 * - MakeCase .clauses: always string[]
 * - RunningInfo .message: always string
 * - StderrOutput .text: always string
 * - SolveAll .solutions: always {interactionPoint, expression}[]
 * - Status: boolean fields always at top level
 *
 * Unknown response kinds pass through unchanged.
 * Returns a shallow copy — never mutates the input.
 */
export function normalizeAgdaResponse(raw: AgdaResponse): AgdaResponse {
  const resp = { ...raw };

  switch (resp.kind) {
    case "InteractionPoints": {
      const pts = resp.interactionPoints;
      if (Array.isArray(pts)) {
        resp.interactionPoints = pts.map((pt) =>
          typeof pt === "number" ? pt : (pt as { id: number }).id,
        );
      }
      break;
    }

    case "DisplayInfo": {
      const rawInfo = resp.info;
      if (rawInfo && typeof rawInfo === "object") {
        const info = { ...(rawInfo as Record<string, unknown>) };
        resp.info = info;

        if (info.kind === "AllGoalsWarnings") {
          for (const field of [
            "visibleGoals",
            "invisibleGoals",
            "errors",
            "warnings",
          ]) {
            info[field] = toArray(info[field]);
          }
        }
      }
      break;
    }

    case "GiveAction": {
      if (resp.giveResult !== undefined)
        resp.giveResult = toString(resp.giveResult);
      if (resp.result !== undefined) resp.result = toString(resp.result);
      break;
    }

    case "MakeCase": {
      const cs = resp.clauses;
      if (Array.isArray(cs)) {
        resp.clauses = cs.map((c: unknown) =>
          typeof c === "string" ? c : toString(c),
        );
      }
      break;
    }

    case "RunningInfo": {
      if (resp.message !== undefined) resp.message = toString(resp.message);
      if (resp.text !== undefined) resp.text = toString(resp.text);
      break;
    }

    case "StderrOutput": {
      if (resp.text !== undefined) resp.text = toString(resp.text);
      break;
    }

    case "SolveAll": {
      const sols = resp.solutions;
      if (Array.isArray(sols)) {
        resp.solutions = sols.map(
          (s: unknown[] | Record<string, unknown>) => {
            if (Array.isArray(s) && s.length >= 2) {
              return { interactionPoint: s[0], expression: s[1] };
            }
            return s;
          },
        );
      }
      break;
    }

    case "Status": {
      if (resp.status && typeof resp.status === "object") {
        const status = resp.status as Record<string, unknown>;
        for (const key of [
          "checked",
          "showImplicitArguments",
          "showIrrelevantArguments",
        ]) {
          if (key in status && !(key in resp)) {
            (resp as Record<string, unknown>)[key] = status[key];
          }
        }
      }
      break;
    }
  }

  return resp;
}
