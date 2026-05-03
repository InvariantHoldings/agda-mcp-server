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
//
// The blocked/common flag lists are curated metadata, not logic, so
// they live in `data/command-line-options.json` and are loaded +
// validated at module init via Zod (issue #15).

import { z } from "zod";
import { loadJsonData } from "../json-data.js";

const commandLineOptionsDataSchema = z.object({
  $comment: z.string().optional(),
  blocked: z.object({
    caseInsensitive: z.array(z.string()),
    caseSensitive: z.array(z.string()),
    prefixes: z.array(z.string()),
  }),
  common: z.array(z.string()),
});

const COMMAND_LINE_OPTIONS_DATA = loadJsonData(
  "./data/command-line-options.json",
  commandLineOptionsDataSchema,
  import.meta.url,
);

/**
 * Maximum length of an individual flag string. Agda's longest
 * documented flag (`--no-projection-like` etc) is well under 50
 * characters; values like `--include-directory=/very/long/path` are
 * the realistic upper bound. 1024 is generous on the upper side and
 * defends against accidental DoS via, e.g., a flag containing a
 * pasted file. Anything longer is almost certainly a mistake.
 */
const MAX_FLAG_LENGTH = 1024;

/**
 * C0 control characters and DEL — these have no place inside an Agda
 * flag and letting them through would either break IOTCM transport
 * (we serialise commands one-per-line; an embedded newline corrupts
 * the stream) or indicate the caller pasted a binary blob instead of
 * a single argument. Tab is rejected too — no real Agda flag uses it.
 */
// eslint-disable-next-line no-control-regex
const FLAG_FORBIDDEN_CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

/**
 * Build a single-line, control-char-escaped preview of a flag for use
 * in error messages. Both the over-length and the control-char errors
 * embed this preview so the caller can identify the offending entry
 * in a long list — without the preview, "control character at index 7"
 * is still a step ahead of just "control character", but pasting the
 * literal flag with its raw control chars would corrupt the log line
 * itself. The preview escapes `\n` / `\r` / `\t` / NUL with their
 * conventional sequences and other control chars with `\xNN`.
 */
function safePreview(raw: string): string {
  const head = raw.length > 32 ? raw.slice(0, 32) + "…" : raw;
  // eslint-disable-next-line no-control-regex
  return head.replace(/[\u0000-\u001f\u007f]/gu, (ch) => {
    switch (ch) {
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\t": return "\\t";
      case "\u0000": return "\\0";
      default: return "\\x" + ch.charCodeAt(0).toString(16).padStart(2, "0");
    }
  });
}

/**
 * Flags that must never be passed in the Cmd_load options list because
 * they conflict with the MCP server's own session management.
 * Long flags are matched case-insensitively; short flags
 * case-sensitively (so `-V` is Agda's `--version` short form, blocked,
 * while `-v` is the verbosity flag and stays allowed).
 */
const BLOCKED_FLAGS_CASE_INSENSITIVE = new Set(COMMAND_LINE_OPTIONS_DATA.blocked.caseInsensitive);
const BLOCKED_FLAGS_CASE_SENSITIVE = new Set(COMMAND_LINE_OPTIONS_DATA.blocked.caseSensitive);

/** Prefixes that indicate a blocked family of flags (case-insensitive). */
const BLOCKED_PREFIXES: ReadonlyArray<string> = COMMAND_LINE_OPTIONS_DATA.blocked.prefixes;

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

  for (let index = 0; index < input.length; index++) {
    const raw = input[index];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length > MAX_FLAG_LENGTH) {
      errors.push(
        `Command-line option at index ${index} exceeds the ${MAX_FLAG_LENGTH}-character limit ` +
        `(got ${trimmed.length}). Real Agda flags are well under this; this ` +
        "looks like an accidentally-pasted blob. Preview: '" +
        safePreview(trimmed) + "'.",
      );
      continue;
    }

    if (FLAG_FORBIDDEN_CONTROL_CHARS.test(trimmed)) {
      errors.push(
        `Command-line option at index ${index} contains a control character ` +
        "(newline, NUL, tab, etc.) which would corrupt IOTCM transport. " +
        "Pass each flag as a single line of printable characters. " +
        "Preview (control chars escaped): '" + safePreview(trimmed) + "'.",
      );
      continue;
    }

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
export const COMMON_AGDA_FLAGS: readonly string[] = COMMAND_LINE_OPTIONS_DATA.common;
