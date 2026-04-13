// MIT License — see LICENSE
//
// Stateless batch type-checking — spawns a temporary AgdaSession,
// loads the file, and destroys the session. Reuses the same
// normalization and parsing infrastructure as the interactive path.
//
// WARNING: do not call this from MCP tool handlers. A disposable session
// shares the repo's _build/ with the singleton AgdaSession but does not
// share currentFile/lastLoadedMtime, which desynchronizes the two tools'
// view of file state (issue #39). Tool handlers should call session.load()
// on the shared singleton instead. This helper exists for standalone tests
// and probes that deliberately exercise the disposable code path.

import type { TypeCheckResult } from "./types.js";
import { AgdaSession } from "./session.js";

/**
 * Type-check a file in a disposable session (stateless).
 *
 * Spawns `agda --interaction-json`, sends Cmd_load, collects the
 * normalized response, and tears down. Uses identical parsing to
 * agda_load — no separate error format, no hardcoded flags.
 */
export async function typeCheckBatch(
  filePath: string,
  repoRoot: string,
): Promise<TypeCheckResult> {
  const session = new AgdaSession(repoRoot);
  try {
    const result = await session.load(filePath);
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
    };
  } finally {
    session.destroy();
  }
}
