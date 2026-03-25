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
    if (!e.isImplicit && e.name && e.type) {
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
