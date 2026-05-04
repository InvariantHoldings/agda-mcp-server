// MIT License — see LICENSE
//
// Shared helpers for load-family session tools (agda_load,
// agda_load_no_metas, agda_typecheck). These tools all have the same
// pre-flight error paths: a sandbox-escaping path becomes
// `invalid-path`, a non-existent file becomes `file-not-found`, and a
// subprocess failure becomes `process-error`. Centralising the error-
// envelope shapes here keeps the three tool registrations in sync —
// if a new field is added to LoadResult the error data shape only has
// to change in one place.

import { errorDiagnostic, errorEnvelope, makeToolResult } from "../tools/tool-helpers.js";
import { PathSandboxError } from "../repo-root.js";
import { validateCommandLineOptions } from "../protocol/command-line-options.js";
import { suggestSimilarFlag } from "../protocol/command-line-suggestions.js";

export type LoadToolName = "agda_load" | "agda_load_no_metas" | "agda_typecheck";

export type PathResolver = (repoRoot: string, file: string) => string;

function baseErrorData(file: string, message: string, classification: string) {
  return {
    file,
    success: false,
    goalIds: [] as number[],
    goalCount: 0,
    invisibleGoalCount: 0,
    hasHoles: false,
    isComplete: false,
    classification,
    errors: [message],
    warnings: [] as string[],
    profiling: null,
  };
}

function reloadFields(tool: LoadToolName) {
  return tool === "agda_typecheck"
    ? {}
    : { reloaded: false, staleBeforeLoad: false };
}

export function missingFileResult(tool: LoadToolName, filePath: string) {
  const message = `File not found: ${filePath}`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "file-not-found",
      data: {
        ...baseErrorData(filePath, message, "file-not-found"),
        ...reloadFields(tool),
      },
      diagnostics: [errorDiagnostic(
        message,
        "file-not-found",
        "Confirm the path is relative to AGDA_MCP_ROOT (or absolute and within it). " +
        "Use `agda_file_list` to see available modules, or `agda_search` to locate one.",
      )],
    }),
  );
}

export function processErrorResult(tool: LoadToolName, file: string, message: string) {
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "process-error",
      data: {
        ...baseErrorData(file, message, "process-error"),
        ...reloadFields(tool),
      },
      diagnostics: [errorDiagnostic(
        message,
        "process-error",
        "The Agda subprocess crashed or could not be started. " +
        "Run `agda --version` to confirm it is installed and on PATH (or set AGDA_BIN), " +
        "then retry the load.",
      )],
    }),
    message,
  );
}

export function invalidPathResult(tool: LoadToolName, file: string) {
  const message = `Invalid file path: ${file}`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "invalid-path",
      data: {
        ...baseErrorData(file, message, "invalid-path"),
        ...reloadFields(tool),
      },
      diagnostics: [errorDiagnostic(
        message,
        "invalid-path",
        "The path resolved outside the project sandbox (PROJECT_ROOT / AGDA_MCP_ROOT). " +
        "Pass a relative path or an absolute path inside the project root.",
      )],
    }),
    message,
  );
}

export function resolveRequestedFilePath(
  repoRoot: string,
  file: string,
  resolveInputFile: PathResolver,
): string {
  try {
    return resolveInputFile(repoRoot, file);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      throw err;
    }
    throw err;
  }
}

/**
 * Run the profile-option validation that every load-family tool shares.
 * Returns a pre-built error ToolResult if the options are invalid, or
 * null if they validate (or are absent). Lets each registration call
 * stay a single `const err = validate...; if (err) return err;` line.
 */
export function validateProfileOptionsOrError(
  tool: LoadToolName,
  file: string,
  profileOptions: string[] | undefined,
  // deliberately an inline type so this file doesn't take a hard
  // dependency on the profile-options module beyond function shape
  runValidation: (opts: string[]) => { valid: boolean; errors: string[] },
) {
  if (!profileOptions || profileOptions.length === 0) return null;
  const validation = runValidation(profileOptions);
  if (validation.valid) return null;
  const message = `Invalid profile options: ${validation.errors.join("; ")}`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "invalid-profile-options",
      data: {
        ...baseErrorData(file, message, "invalid-profile-options"),
        ...reloadFields(tool),
        errors: validation.errors,
      },
      diagnostics: validation.errors.map((msg) =>
        errorDiagnostic(
          msg,
          "invalid-profile-option",
          "Pass profile options from the documented set (internal, modules, definitions, " +
          "sharing, serialize, constraints, metas, interactive, conversion, all). " +
          "Call `agda_show_version` to see what your Agda build accepts; the mutually-" +
          "exclusive group is internal/modules/definitions.",
        ),
      ),
    }),
  );
}

/**
 * Run command-line option validation at the tool boundary.
 * Returns a pre-built error ToolResult (ok=false) if any option is
 * invalid or blocked, or null if validation passes (or options are absent).
 *
 * This mirrors validateProfileOptionsOrError so that invalid CLI flags
 * are rejected consistently with invalid profile options — as a tool
 * error, not embedded in an okEnvelope with a classification.
 */
export function validateCommandLineOptionsOrError(
  tool: LoadToolName,
  file: string,
  commandLineOptions: string[] | undefined,
) {
  if (!commandLineOptions || commandLineOptions.length === 0) return null;
  const validation = validateCommandLineOptions(commandLineOptions);
  if (validation.valid) return null;

  const enrichedErrors = enrichWithSuggestions(commandLineOptions, validation.errors);
  const message = `Invalid command-line options: ${enrichedErrors.join("; ")}`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "invalid-command-line-options",
      data: {
        ...baseErrorData(file, message, "invalid-command-line-options"),
        ...reloadFields(tool),
        errors: enrichedErrors,
      },
      diagnostics: enrichedErrors.map((msg) =>
        errorDiagnostic(
          msg,
          "invalid-command-line-option",
          "Each entry must start with '-' and not collide with the MCP server's interactive " +
          "session mode (--interaction-json, --version, etc. are reserved). Use " +
          "`agda_project_config` to inspect resolved file/env defaults; pass per-call options " +
          "as an array of strings, one flag per entry.",
        ),
      ),
    }),
  );
}

/**
 * Append a "did you mean ...?" hint to an error when the offending
 * input looks like a typo of a `COMMON_AGDA_FLAGS` entry. The hint is
 * appended once per error string — we don't try to be clever about
 * which input produced which error message, just match against any
 * input the user passed.
 */
function enrichWithSuggestions(
  inputs: readonly string[],
  errors: readonly string[],
): string[] {
  const suggestions = new Map<string, string>();
  for (const input of inputs) {
    const trimmed = input.trim();
    if (trimmed.length === 0) continue;
    const suggestion = suggestSimilarFlag(trimmed);
    if (suggestion && suggestion !== trimmed) {
      suggestions.set(trimmed, suggestion);
    }
  }
  if (suggestions.size === 0) return [...errors];

  return errors.map((message) => {
    for (const [bad, good] of suggestions) {
      if (message.includes(`'${bad}'`)) {
        return `${message} Did you mean '${good}'?`;
      }
    }
    return message;
  });
}
