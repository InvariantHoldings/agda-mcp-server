// MIT License — see LICENSE
//
// Stateless batch type-checking — spawns a temporary AgdaSession,
// loads the file, and destroys the session. Reuses the same
// normalization and parsing infrastructure as the interactive path.

import type { TypeCheckResult } from "./types.js";
import { AgdaSession } from "./session.js";

/**
 * Type-check a file in a disposable session (stateless).
 *
 * Spawns `agda --interaction-json`, sends Cmd_load, collects the
 * normalized response, and tears down. Uses identical parsing to
 * agda_load — no separate error format, no hardcoded flags.
 *
 * @param filePath       Path to the Agda file to type-check.
 * @param repoRoot       Repository root for path resolution.
 * @param options        Optional settings for the type-check.
 * @param options.profileOptions  Agda profile options (e.g. ["modules"]).
 */
export async function typeCheckBatch(
  filePath: string,
  repoRoot: string,
  options?: { profileOptions?: string[] },
): Promise<TypeCheckResult> {
  const session = new AgdaSession(repoRoot);
  try {
    const result = await session.load(filePath, options);
    return {
      success: result.success,
      errors: result.errors,
      warnings: result.warnings,
      goals: result.goals,
      invisibleGoalCount: result.invisibleGoalCount,
      goalCount: result.goalCount,
      hasHoles: result.hasHoles,
      isComplete: result.isComplete,
      classification: result.classification,
      profiling: result.profiling,
    };
  } finally {
    session.destroy();
  }
}
