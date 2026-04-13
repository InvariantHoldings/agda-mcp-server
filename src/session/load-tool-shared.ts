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
      diagnostics: [errorDiagnostic(message, "invalid-path")],
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
        errorDiagnostic(msg, "invalid-profile-option"),
      ),
    }),
  );
}
