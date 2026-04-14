// MIT License — see LICENSE
//
// Test-only disposable type-check helper.
//
// This spawns a fresh AgdaSession, loads a file, and tears it down. It
// intentionally exists OUTSIDE src/ so no MCP tool handler can import it:
// routing load-family tools through a disposable session desynchronizes
// currentFile/lastLoadedMtime with the singleton AgdaSession and leaves
// the two tools with inconsistent views of _build/ state (issue #39).
// Production tools must route through the singleton AgdaSession created
// in src/index.ts.
//
// Tests still need the disposable path to probe lifecycle and library
// registration behavior — that is the one legitimate caller.

import type { TypeCheckResult } from "../../src/agda-process.js";
import { AgdaSession } from "../../src/agda-process.js";

export async function typeCheckDisposable(
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
