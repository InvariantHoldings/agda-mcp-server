// MIT License — see LICENSE
//
// Helpers for runLoad / runLoadNoMetas: result builders, option
// validation, classification, and the Cmd_metas reconciliation. Split
// out of session-load-impl.ts to keep that file under the size ceiling.

import { readFileSync } from "node:fs";

import type { AgdaSession } from "./session.js";
import type { LoadResult } from "./types.js";
import { NOT_FOUND_RESULT } from "./session-constants.js";
import { mergeGoals } from "./goal-merging.js";
import { logger } from "./logger.js";
import { stringList } from "../protocol/command-builder.js";
import { findGoalPositions } from "../session/goal-positions.js";
import { validateProfileOptions, toProfileArgs } from "../protocol/profile-options.js";
import { validateCommandLineOptions } from "../protocol/command-line-options.js";

export function fileNotFound(absPath: string): LoadResult {
  return { ...NOT_FOUND_RESULT, errors: [`File not found: ${absPath}`] };
}

function failedLoadResult(
  errors: string[],
  classification: string,
  extra?: Partial<LoadResult>,
): LoadResult {
  return {
    success: false,
    errors,
    warnings: [],
    goals: [],
    allGoalsText: "",
    invisibleGoalCount: 0,
    goalCount: 0,
    hasHoles: false,
    isComplete: false,
    classification,
    profiling: null,
    ...extra,
  };
}

export function invalidOptions(errors: string[], classification: string): LoadResult {
  return failedLoadResult(errors, classification);
}

/** Cmd_load succeeded but the follow-up Cmd_metas killed the proc, so
 *  in-memory load state is gone. Report failure so the agent reloads. */
export function loadFailedAfterReconciliation(
  absPath: string,
  warnings: string[],
  profiling: LoadResult["profiling"],
): LoadResult {
  return failedLoadResult(
    [
      `Agda subprocess died during post-load reconciliation for ${absPath}. ` +
      `Cmd_load succeeded but the follow-up metas query timed out or crashed; re-issue agda_load.`,
    ],
    "process-died-during-reconciliation",
    { warnings, profiling },
  );
}

/** No terminal goal-state event (AllGoalsWarnings / Error /
 *  InteractionPoints) in the Cmd_load stream — it was truncated before
 *  Agda finished, so `parsed.success` is untrustworthy. Report unknown
 *  rather than a possibly-false clean load. */
export function loadIncompleteNoTerminus(
  absPath: string,
  warnings: string[],
  profiling: LoadResult["profiling"],
): LoadResult {
  return failedLoadResult(
    [
      `Agda returned no terminal goal-state event for ${absPath} ` +
      `(no AllGoalsWarnings / Error / InteractionPoints). The response stream was truncated ` +
      `before type-checking finished — re-issue agda_load for a fresh result.`,
    ],
    "load-incomplete-no-terminus",
    { warnings, profiling },
  );
}

/** Clear load-success markers at the start of a load so a throwing or
 *  incomplete load can't leave stale success visible. currentFile is
 *  nulled too — Cmd_load uses an explicit path, not currentFile, and an
 *  in-flight load has no interaction state to point at yet. */
export function invalidatePriorLoadState(session: AgdaSession): void {
  session.currentFile = null;
  session.goalIds = [];
  session.lastLoadedMtime = null;
  session.lastClassification = null;
  session.lastLoadedAt = null;
  session.lastInvisibleGoalCount = 0;
}

export interface MetasReconciliation {
  goals: LoadResult["goals"];
  goalIds: number[];
  /** Cmd_metas killed the proc (session state cleared). */
  procDied: boolean;
}

/** Best-effort Cmd_metas to enrich goal types and recover goal IDs the
 *  load stream may have dropped. Used for the post-load
 *  reconciliation and as a settled re-query. */
export async function reconcileGoalsViaMetas(
  session: AgdaSession,
  absPath: string,
  baseGoals: LoadResult["goals"],
): Promise<MetasReconciliation> {
  let goals = baseGoals;
  let goalIds = baseGoals.map((goal) => goal.goalId);
  try {
    const metas = await session.goal.metas();
    if (metas.goals.length > 0) {
      goals = mergeGoals(baseGoals, metas.goals);
      goalIds = goals.map((goal) => goal.goalId);
    }
  } catch (err) {
    logger.warn("post-load metas reconciliation failed", {
      file: absPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { goals, goalIds, procDied: session.currentFile !== absPath };
}

export function buildLoadOptionsList(
  profileOptions: string[] | undefined,
  commandLineOptions?: string[],
):
  | { ok: true; optsList: string; profilingEnabled: boolean }
  | { ok: false; result: LoadResult } {
  const allArgs: string[] = [];
  let profilingEnabled = false;

  if (profileOptions && profileOptions.length > 0) {
    const validation = validateProfileOptions(profileOptions);
    if (!validation.valid) {
      return { ok: false, result: invalidOptions(validation.errors, "invalid-profile-options") };
    }
    allArgs.push(...toProfileArgs(validation.options));
    profilingEnabled = true;
  }

  if (commandLineOptions && commandLineOptions.length > 0) {
    const validation = validateCommandLineOptions(commandLineOptions);
    if (!validation.valid) {
      return { ok: false, result: invalidOptions(validation.errors, "invalid-command-line-options") };
    }
    allArgs.push(...validation.options);
  }

  return { ok: true, optsList: stringList(allArgs), profilingEnabled };
}

/** Classify a load from protocol goals, invisible metas, and source
 *  hole markers. `goalCount` must equal the goals[] length; the source
 *  hole count only feeds `hasHoles`, never `goalCount`. */
export function classifyLoadResult(input: {
  success: boolean;
  goalCount: number;
  invisibleGoalCount: number;
  sourceHoleCount: number;
}): { hasHoles: boolean; isComplete: boolean; classification: string } {
  const hasHoles =
    input.goalCount > 0 || input.invisibleGoalCount > 0 || input.sourceHoleCount > 0;
  const isComplete = input.success && !hasHoles;
  const classification = input.success
    ? hasHoles ? "ok-with-holes" : "ok-complete"
    : "type-error";
  return { hasHoles, isComplete, classification };
}

export function countExplicitSourceHoles(absPath: string): number {
  try {
    return findGoalPositions(readFileSync(absPath, "utf8")).length;
  } catch (err) {
    logger.warn("explicit hole scan failed", {
      file: absPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
