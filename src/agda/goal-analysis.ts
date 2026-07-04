// MIT License — see LICENSE
//
// Goal analysis utilities for AI consumers.
// Parses context entries, derives actionable suggestions,
// and finds matching terms — all pure functions.

export interface ContextEntry {
  name: string;
  type: string;
  isImplicit: boolean;
}

export interface Suggestion {
  action: "give" | "refine" | "case_split" | "auto" | "intro";
  reason: string;
  expr?: string;
  variable?: string;
}

/**
 * Parse a context entry string like "x : Nat" or "{A : Set}"
 * into structured form.
 */
export function parseContextEntry(entry: string): ContextEntry {
  const trimmed = entry.trim();
  const isImplicit = trimmed.startsWith("{");

  // Strip outer braces for implicit entries
  const inner = isImplicit
    ? trimmed.replace(/^\{/, "").replace(/\}$/, "").trim()
    : trimmed;

  const colonIdx = inner.indexOf(" : ");
  if (colonIdx >= 0) {
    return {
      name: inner.slice(0, colonIdx).trim(),
      type: inner.slice(colonIdx + 3).trim(),
      isImplicit,
    };
  }

  // Fallback: can't parse, use whole string as name
  return { name: inner || trimmed, type: "", isImplicit };
}

/**
 * Derive actionable suggestions for an AI based on goal type and context.
 * Always returns at least one suggestion (auto as fallback).
 */
export function deriveSuggestions(
  goalType: string,
  context: ContextEntry[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const nameCounts = new Map<string, number>();

  for (const entry of context) {
    if (!entry.name) {
      continue;
    }
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  }

  // If goal type is an equality, suggest refl
  if (goalType.includes("≡")) {
    suggestions.push({
      action: "give",
      expr: "refl",
      reason: "Goal is an equality — try refl",
    });
  }

  // If goal type is a function type, suggest refine/intro
  if (goalType.includes("→") || goalType.includes("∀") || goalType.includes("Π")) {
    suggestions.push({
      action: "refine",
      reason: "Goal is a function type — refine to introduce arguments",
    });
    suggestions.push({
      action: "intro",
      reason: "Goal is a function type — introduce a lambda",
    });
  }

  // If context has variables with matching type, suggest give
  for (const e of context) {
    if (!e.isImplicit && e.type === goalType && e.type) {
      suggestions.push({
        action: "give",
        expr: e.name,
        reason: `${e.name} has matching type ${e.type}`,
      });
    }
  }

  // Suggest case split on non-implicit variables
  for (const e of context) {
    if (!e.isImplicit && e.name && e.type && (nameCounts.get(e.name) ?? 0) === 1) {
      suggestions.push({
        action: "case_split",
        variable: e.name,
        reason: `Split on ${e.name} : ${e.type}`,
      });
    }
  }

  // Always include auto as fallback
  suggestions.push({
    action: "auto",
    reason: "Try Agda's proof search",
  });

  return suggestions;
}

/**
 * Find context entries whose type matches the target type.
 * Only searches non-implicit entries.
 */
export function findMatchingTerms(
  targetType: string,
  context: ContextEntry[],
): ContextEntry[] {
  return context.filter(
    (e) => !e.isImplicit && e.type === targetType,
  );
}

// ── Type-directed term matching ─────────────────────────────────────
//
// `findMatchingTerms` only accepts an exact type-string equality, so it
// misses a function whose *result* type is the goal type (apply it to
// arguments to fill the goal). The helpers below add result-type matching
// with an argument count, and normalize whitespace so Agda's pretty-printed
// spacing doesn't defeat the comparison. All pure and total (never throw).

export interface TypedCandidate {
  name: string;
  /** The candidate's type, as printed by Agda. */
  type: string;
}

export interface TermTypeMatch {
  name: string;
  type: string;
  /** `exact`: the candidate's type is the goal type. `result`: the
   *  candidate is a function whose result type is the goal type. */
  match: "exact" | "result";
  /** Arguments needed before the term has the goal type (0 for `exact`). */
  arity: number;
}

/** Collapse internal whitespace so pretty-printer spacing doesn't matter. */
function normalizeType(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Split a type on its TOP-LEVEL function arrows (`→` or `->`), ignoring
 * arrows nested inside (), {}, or []. Empty segments are dropped.
 */
function splitTopLevelArrows(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < type.length; i++) {
    const ch = type[i];
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && ch === "→") {
      parts.push(type.slice(start, i));
      start = i + 1;
    } else if (depth === 0 && ch === "-" && type[i + 1] === ">") {
      parts.push(type.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(type.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Strip one fully-enclosing pair of parentheses, if present. */
function stripOuterParens(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let enclosing = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i < t.length - 1) {
          enclosing = false;
          break;
        }
      }
    }
    if (!enclosing || depth !== 0) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Reduce a (function) type to its final result type, counting how many
 * arguments must be supplied to reach it. `A → B → C` → `{ resultType: "C",
 * arity: 2 }`; a non-function type returns itself with arity 0.
 */
export function resultTypeOf(type: string): { resultType: string; arity: number } {
  let cur = normalizeType(type);
  let arity = 0;
  for (let guard = 0; guard < 100; guard++) {
    const stripped = stripOuterParens(cur);
    const segments = splitTopLevelArrows(stripped);
    if (segments.length <= 1) {
      cur = stripped;
      break;
    }
    arity += segments.length - 1;
    cur = normalizeType(segments[segments.length - 1]);
  }
  return { resultType: cur, arity };
}

/**
 * Type-directed candidate search: keep candidates whose type IS the goal
 * type (`exact`) or whose RESULT type is the goal type (`result`, a function
 * to apply). Sorted exact-first, then fewest arguments, then by name.
 */
export function matchTermsByType(
  targetType: string,
  candidates: TypedCandidate[],
): TermTypeMatch[] {
  const target = normalizeType(targetType);
  if (!target) return [];
  const matches: TermTypeMatch[] = [];
  for (const candidate of candidates) {
    const candidateType = normalizeType(candidate.type);
    if (!candidateType) continue;
    if (candidateType === target) {
      matches.push({ name: candidate.name, type: candidate.type, match: "exact", arity: 0 });
      continue;
    }
    const { resultType, arity } = resultTypeOf(candidate.type);
    if (arity > 0 && normalizeType(resultType) === target) {
      matches.push({ name: candidate.name, type: candidate.type, match: "result", arity });
    }
  }
  matches.sort((a, b) => {
    if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
    if (a.arity !== b.arity) return a.arity - b.arity;
    return a.name.localeCompare(b.name);
  });
  return matches;
}
