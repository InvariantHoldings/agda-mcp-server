// MIT License — see LICENSE
//
// Command-line option types and validation for Agda's Cmd_load [String] argument.
//
// Agda's IOTCM `Cmd_load` accepts a list of command-line flags as its
// second argument: `Cmd_load "<file>" ["--flag1", "--flag2", ...]`.
// This module validates and normalizes those flags.
//
// Reference:
//   - Agda IOTCM protocol: https://agda.readthedocs.io/en/latest/tools/emacs-mode.html
//   - Agda command-line options: https://agda.readthedocs.io/en/latest/tools/command-line-options.html
//   - Agda Interaction.Options (source): https://github.com/agda/agda/blob/master/src/full/Agda/Interaction/Options.hs
//
// Unlike profile options (which have a closed set of valid values),
// command-line options are an open set matching Agda's full CLI.
// We validate structure (must start with `-`) and reject known
// dangerous patterns but do not whitelist every possible flag.

/**
 * Flags that must never be passed in the Cmd_load options list because
 * they conflict with the MCP server's own session management.
 *
 * Stored in lowercase for case-insensitive matching. Short flags like
 * "-V" are matched case-sensitively via BLOCKED_FLAGS_CASE_SENSITIVE.
 */
const BLOCKED_FLAGS_CASE_INSENSITIVE = new Set([
  "--interaction",
  "--interaction-json",
  "--interaction-exit-on-error",
  "--version",
  "--help",
  "--print-agda-dir",
]);

/**
 * Short flags that must be matched case-sensitively (e.g. "-V" is
 * Agda's short --version, but "-v" is a verbosity flag).
 */
const BLOCKED_FLAGS_CASE_SENSITIVE = new Set([
  "-V",
  "-?",
]);

/**
 * Prefixes that indicate a blocked family of flags (case-insensitive).
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
  // Case-sensitive check for short flags
  if (BLOCKED_FLAGS_CASE_SENSITIVE.has(flag)) return true;
  // Case-insensitive check for long flags
  const lower = flag.toLowerCase();
  if (BLOCKED_FLAGS_CASE_INSENSITIVE.has(lower)) return true;
  for (const prefix of BLOCKED_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
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
 *
 * Reference: Agda's Cmd_load accepts `FilePath [String]` where the list
 * contains command-line options passed to the type-checker, such as
 * `["--safe", "--Werror"]`. See:
 * https://github.com/agda/agda/blob/master/src/full/Agda/Interaction/BasicOps.hs
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
 *
 * Reference: https://agda.readthedocs.io/en/latest/tools/command-line-options.html
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
  "--injective-type-constructors",
  "--warning",
  "-W",
];
