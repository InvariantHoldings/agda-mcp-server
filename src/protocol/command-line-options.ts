// MIT License — see LICENSE
//
// Command-line option types and validation for Agda's Cmd_load [String] argument.
//
// Agda's IOTCM `Cmd_load` accepts a list of command-line flags as its
// second argument: `Cmd_load "<file>" ["--flag1", "--flag2", ...]`.
// This module validates and normalizes those flags.
//
// Unlike profile options (which have a closed set of valid values),
// command-line options are an open set matching Agda's full CLI.
// We validate structure (must start with `-`) and reject known
// dangerous patterns but do not whitelist every possible flag.

/**
 * Flags that must never be passed in the Cmd_load options list because
 * they conflict with the MCP server's own session management.
 */
const BLOCKED_FLAGS = new Set([
  "--interaction",
  "--interaction-json",
  "--interaction-exit-on-error",
  // Mode flags that don't make sense inside an interactive session
  "--version",
  "-V",
  "--help",
  "-?",
  "--print-agda-dir",
]);

/**
 * Prefixes that indicate a blocked family of flags.
 */
const BLOCKED_PREFIXES: string[] = [
  "--interaction",
];

export interface CommandLineOptionsValidation {
  valid: boolean;
  errors: string[];
  /** The validated, deduplicated options ready to pass to Cmd_load. */
  options: string[];
}

function isBlockedFlag(flag: string): boolean {
  const normalized = flag.toLowerCase();
  if (BLOCKED_FLAGS.has(normalized)) return true;
  for (const prefix of BLOCKED_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Validate a list of command-line option strings for Cmd_load.
 *
 * Rules:
 * - Each option must start with `-` (flag syntax).
 * - Options that conflict with the MCP server's session mode are rejected.
 * - Empty strings are silently skipped.
 * - Duplicates are deduplicated (preserving order).
 */
export function validateCommandLineOptions(
  input: readonly string[],
): CommandLineOptionsValidation {
  const errors: string[] = [];
  const seen = new Set<string>();
  const options: string[] = [];

  for (const raw of input) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    if (!trimmed.startsWith("-")) {
      errors.push(
        `Invalid command-line option '${trimmed}': must start with '-'. ` +
        "Pass flags like '--Werror', '--safe', '--no-universe-polymorphism', etc.",
      );
      continue;
    }

    if (isBlockedFlag(trimmed)) {
      errors.push(
        `Blocked command-line option '${trimmed}': this flag conflicts with the MCP server's interactive session mode.`,
      );
      continue;
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      options.push(trimmed);
    }
  }

  return { valid: errors.length === 0, errors, options };
}

/**
 * Well-known Agda command-line options for documentation/autocomplete.
 * This is not exhaustive — Agda accepts many more flags.
 */
export const COMMON_AGDA_FLAGS: readonly string[] = [
  "--safe",
  "--Werror",
  "--no-universe-polymorphism",
  "--omega-in-omega",
  "--no-sized-types",
  "--no-guardedness",
  "--cubical",
  "--cubical-compatible",
  "--erasure",
  "--erased-cubical",
  "--without-K",
  "--with-K",
  "--copatterns",
  "--no-copatterns",
  "--no-eta-equality",
  "--exact-split",
  "--no-exact-split",
  "--no-forcing",
  "--no-projection-like",
  "--allow-unsolved-metas",
  "--allow-incomplete-matches",
  "--no-positivity-check",
  "--no-termination-check",
  "--type-in-type",
  "--prop",
  "--no-prop",
  "--two-level",
  "--cumulativity",
  "--no-import-sorts",
  "--local-confluence-check",
  "--confluence-check",
  "--flat-split",
  "--cohesion",
  "--no-load-primitives",
  "--no-pattern-matching",
  "--rewriting",
  "--postfix-projections",
  "--keep-pattern-variables",
  "--instance-search-depth",
  "--inversion-max-depth",
  "--termination-depth",
  "--show-implicit",
  "--show-irrelevant",
  "--no-unicode",
  "--count-clusters",
  "--auto-inline",
  "--no-auto-inline",
  "--no-fast-reduce",
  "--call-by-name",
  "--no-forcing",
  "--injective-type-constructors",
  "--warning",
  "-W",
];
