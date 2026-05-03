// MIT License — see LICENSE
//
// Static-analysis classifier for raw Agda compiler/MCP error text.
// Produces a `TriageResult` with a category, confidence score, and
// machine-readable suggested action. Used by `agda_triage_error` and
// any tool that wants to route an error to the right fix path.
//
// Pure: no I/O, no session state. Each classifier branch is keyed on
// regex matches against the error message.

export type TriageClass =
  | "mechanical-import"
  | "mechanical-rename"
  | "parser-regression"
  | "coverage-missing"
  | "proof-obligation"
  | "dep-failure"
  | "toolchain";

export interface TriageSuggestedAction {
  action: string;
  symbol?: string;
  from?: string;
  to?: string;
  module?: string;
}

export interface TriageResult {
  category: TriageClass;
  confidence: number;
  suggestedAction: TriageSuggestedAction;
  suggestedRename?: string;
}

/** Clamp a value into the [0, 1] probability range with 2-decimal rounding. */
function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

/** Public alias of `clampProbability` — re-exported via the barrel. */
export function normalizeConfidence(value: number): number {
  return clampProbability(value);
}

/**
 * Strip Agda's compiler-generated `.AGDA` / `.LAGDA[.X]` placeholders
 * out of an error message so downstream regex matches don't have to
 * branch on the literal extension. Used both by the classifier and
 * by tools that surface the error message verbatim to a human.
 */
export function rewriteCompilerPlaceholders(message: string): string {
  return message
    .replace(/\.AGDA\b/g, "<ext>")
    .replace(/\.LAGDA(?:\.[A-Z]+)?\b/giu, "<ext>");
}

/**
 * Pull a `Did you mean 'foo'?` suggestion out of an Agda error. Tries
 * the quoted form first, falls back to a bare-word form for older /
 * shorter error templates. Returns null if no hint is present.
 */
export function extractSuggestedRename(message: string): string | null {
  const normalized = rewriteCompilerPlaceholders(message);

  const quoted = /did you mean\s+[`'"]([^`'"\n]+)[`'"]\??/iu.exec(normalized);
  if (quoted) return quoted[1].trim() || null;

  const bare = /did you mean\s+([^\s,.;:!?()]+)\??/iu.exec(normalized);
  if (bare) return bare[1].trim() || null;

  return null;
}

/** Pull a `Not in scope: x` symbol out of an error, if present. */
function parseNotInScopeSymbol(message: string): string | undefined {
  const quoted = /not in scope:\s*[`'"]([^`'"\n]+)[`'"]/iu.exec(message);
  if (quoted) return quoted[1].trim() || undefined;
  const bare = /not in scope:\s*([^\s,.;:!?()]+)/iu.exec(message);
  return bare?.[1]?.trim() || undefined;
}

/**
 * Classify a raw Agda error into one of the seven triage categories.
 *
 * Branches are ordered by specificity: toolchain failures first
 * (most discriminative), then mechanical (rename / import), then
 * parser, coverage, dependency, and finally a `proof-obligation`
 * catchall. Confidence values are calibrated so that downstream
 * routing can use thresholds (e.g. `confidence >= 0.9` to auto-apply,
 * lower to surface as suggestion).
 */
export function classifyAgdaError(message: string): TriageResult {
  const normalized = rewriteCompilerPlaceholders(message);
  const lower = normalized.toLowerCase();
  const suggestedRename = extractSuggestedRename(normalized) ?? undefined;
  const symbol = parseNotInScopeSymbol(normalized);

  if (
    /command not found|no such file or directory|failed to start|permission denied|cannot execute/iu.test(normalized)
    || lower.includes("agda_dir")
    || lower.includes("library") && lower.includes("not found")
  ) {
    return {
      category: "toolchain",
      confidence: 0.95,
      suggestedAction: { action: "verify-toolchain" },
      suggestedRename,
    };
  }

  if (
    /module .* doesn't export|moduledoesntexport/iu.test(normalized)
    || (suggestedRename !== undefined && /export/iu.test(normalized))
  ) {
    return {
      category: suggestedRename ? "mechanical-rename" : "mechanical-import",
      confidence: suggestedRename ? 0.93 : 0.85,
      suggestedAction: suggestedRename
        ? { action: "apply_rename", to: suggestedRename }
        : { action: "fix_import" },
      suggestedRename,
    };
  }

  if (
    /not in scope|unknown name|unknown identifier/iu.test(normalized)
    || /cannot resolve module/iu.test(normalized)
  ) {
    if (suggestedRename) {
      return {
        category: "mechanical-rename",
        confidence: 0.91,
        suggestedAction: {
          action: "apply_rename",
          symbol,
          to: suggestedRename,
        },
        suggestedRename,
      };
    }
    return {
      category: "mechanical-import",
      confidence: 0.87,
      suggestedAction: { action: "suggest_import", symbol },
      suggestedRename,
    };
  }

  if (/parse error|lexical error|could not parse|failed to parse/iu.test(normalized)) {
    return {
      category: "parser-regression",
      confidence: 0.92,
      suggestedAction: { action: "repair_parser_syntax" },
      suggestedRename,
    };
  }

  if (/coverage|incomplete pattern matching|missing cases|missing clause/iu.test(normalized)) {
    return {
      category: "coverage-missing",
      confidence: 0.89,
      suggestedAction: { action: "add_missing_clauses" },
      suggestedRename,
    };
  }

  if (
    /dependency|import cycle|while scope checking|while checking the declaration of/iu.test(normalized)
    && /in [^ ]+\.agda/iu.test(normalized)
  ) {
    return {
      category: "dep-failure",
      confidence: 0.78,
      suggestedAction: { action: "repair_dependency" },
      suggestedRename,
    };
  }

  return {
    category: "proof-obligation",
    confidence: 0.72,
    suggestedAction: { action: "open_interactive_goal" },
    suggestedRename,
  };
}
