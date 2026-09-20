import { readFileSync } from "node:fs";
import type { AgdaSession } from "./session.js";
import type { LoadResult } from "./types.js";

export function sourceSnapshot(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

export function clearUntrustedLoadState(session: AgdaSession): void {
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastInvisibleGoalCount = 0;
}

export function cancelledLoadResult(
  absPath: string,
  warnings: string[],
  profiling: LoadResult["profiling"],
): LoadResult {
  return {
    success: false,
    errors: [`Agda load for ${absPath} was cancelled by a control command.`],
    warnings,
    goals: [],
    allGoalsText: "",
    invisibleGoalCount: 0,
    goalCount: 0,
    hasHoles: false,
    isComplete: false,
    classification: "cancelled",
    profiling,
  };
}

export function sourceChangedResult(
  absPath: string,
  warnings: string[],
  profiling: LoadResult["profiling"],
): LoadResult {
  return {
    success: false,
    errors: [
      `Source changed while Agda was checking ${absPath}; ` +
      "discarded the response because its evidence is stale. Re-issue agda_load.",
    ],
    warnings,
    goals: [],
    allGoalsText: "",
    invisibleGoalCount: 0,
    goalCount: 0,
    hasHoles: false,
    isComplete: false,
    classification: "type-error",
    profiling,
  };
}
