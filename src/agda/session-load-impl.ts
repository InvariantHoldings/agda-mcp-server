// MIT License — see LICENSE
//
// Implementations of AgdaSession.load() and AgdaSession.loadNoMetas()
// extracted as free functions that operate on a session reference.
// Keeping the load orchestration here instead of inline in
// session.ts lets the class file stay under ~400 lines and makes the
// load-path easier to reason about as a self-contained unit (Cmd_load
// construction → response parse → session state update → return
// value). These functions mutate session state (currentFile, goalIds,
// lastLoadedMtime, lastClassification, lastLoadedAt) as a deliberate
// side effect — the session fields are readable via public getters
// and writable here because they're module-internal, not a public
// API surface for consumers.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { AgdaSession } from "./session.js";
import type { LoadResult } from "./types.js";
import { NOT_FOUND_RESULT } from "./session-constants.js";
import { parseLoadResponses } from "./parse-load-responses.js";
import { throwOnFatalProtocolStderr } from "./protocol-errors.js";
import { mergeGoals } from "./goal-merging.js";
import { logger } from "./logger.js";
import { command, quoted, profileOptionsList } from "../protocol/command-builder.js";
import { findGoalPositions } from "../session/goal-positions.js";
import {
  validateProfileOptions,
  toProfileArgs,
} from "../protocol/profile-options.js";

function fileNotFound(absPath: string): LoadResult {
  return {
    ...NOT_FOUND_RESULT,
    errors: [`File not found: ${absPath}`],
  };
}

function invalidProfileOptions(errors: string[]): LoadResult {
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
    classification: "invalid-profile-options",
    profiling: null,
  };
}

function buildLoadOptionsList(profileOptions: string[] | undefined):
  | { ok: true; optsList: string; profilingEnabled: boolean }
  | { ok: false; result: LoadResult } {
  if (!profileOptions || profileOptions.length === 0) {
    return { ok: true, optsList: "[]", profilingEnabled: false };
  }
  const validation = validateProfileOptions(profileOptions);
  if (!validation.valid) {
    return { ok: false, result: invalidProfileOptions(validation.errors) };
  }
  const profileArgs = toProfileArgs(validation.options);
  return {
    ok: true,
    optsList: profileOptionsList(profileArgs),
    profilingEnabled: true,
  };
}

function classifyParsedLoad(parsed: {
  success: boolean;
  goals: unknown[];
  invisibleGoalCount: number;
}, goalCount: number): {
  hasHoles: boolean;
  isComplete: boolean;
  classification: string;
} {
  const hasHoles = goalCount > 0 || parsed.invisibleGoalCount > 0;
  const isComplete = parsed.success && !hasHoles;
  const classification = parsed.success
    ? hasHoles
      ? "ok-with-holes"
      : "ok-complete"
    : "type-error";
  return { hasHoles, isComplete, classification };
}

function countExplicitSourceHoles(absPath: string): number {
  try {
    const source = readFileSync(absPath, "utf8");
    return findGoalPositions(source).length;
  } catch (err) {
    logger.warn("explicit hole scan failed", {
      file: absPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export async function runLoad(
  session: AgdaSession,
  filePath: string,
  options?: { profileOptions?: string[] },
): Promise<LoadResult> {
  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return fileNotFound(absPath);
  }

  const optsBuild = buildLoadOptionsList(options?.profileOptions);
  if (!optsBuild.ok) {
    return optsBuild.result;
  }

  // Use buildIotcm with absPath directly — don't set currentFile yet
  // because ensureProcess() (called inside sendCommand) resets it.
  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load", quoted(absPath), optsBuild.optsList)),
  );
  throwOnFatalProtocolStderr(responses);
  const parsed = parseLoadResponses(responses, { profilingEnabled: optsBuild.profilingEnabled });

  // Set session state before reconciling metas so follow-up queries can run.
  session.currentFile = absPath;
  session.goalIds = parsed.goalIds;
  session.lastLoadedMtime = statSync(absPath).mtimeMs;

  let goals = parsed.goals;
  let goalIds = parsed.goalIds;

  if (parsed.success) {
    try {
      const metas = await session.goal.metas();
      if (metas.goals.length > 0) {
        goals = mergeGoals(parsed.goals, metas.goals);
        goalIds = goals.map((goal) => goal.goalId);
      }
    } catch (err) {
      logger.warn("post-load metas reconciliation failed", {
        file: absPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Only scan the source for explicit hole markers when the protocol
  // reports a nominally-clean result (no goals, no invisible metas).
  // This avoids redundant I/O on large modules where the protocol
  // already correctly reports holes.
  const needsExplicitHoleScan =
    parsed.success && goals.length === 0 && parsed.invisibleGoalCount === 0;
  const sourceHoleCount = needsExplicitHoleScan ? countExplicitSourceHoles(absPath) : 0;

  // goalCount must match the actual goals array length so consumers
  // can safely index into it.  sourceHoleCount feeds into hasHoles
  // for classification only.
  const goalCount = goals.length;
  const hasHoles = goalCount > 0 || parsed.invisibleGoalCount > 0 || sourceHoleCount > 0;
  const isComplete = parsed.success && !hasHoles;
  const classification = parsed.success
    ? hasHoles
      ? "ok-with-holes"
      : "ok-complete"
    : "type-error";

  session.goalIds = goalIds;
  session.lastClassification = classification;
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = parsed.invisibleGoalCount;

  logger.trace("load complete", {
    file: absPath,
    success: parsed.success,
    goals: goals.length,
    errors: parsed.errors.length,
  });

  return {
    success: parsed.success,
    errors: parsed.errors,
    warnings: parsed.warnings,
    goals,
    allGoalsText: parsed.allGoalsText,
    invisibleGoalCount: parsed.invisibleGoalCount,
    goalCount,
    hasHoles,
    isComplete,
    classification,
    profiling: parsed.profiling,
    lastCheckedLine: parsed.lastCheckedLine ?? null,
  };
}

export async function runLoadNoMetas(
  session: AgdaSession,
  filePath: string,
): Promise<LoadResult> {
  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return fileNotFound(absPath);
  }

  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load_no_metas", quoted(absPath))),
  );
  throwOnFatalProtocolStderr(responses);
  const parsed = parseLoadResponses(responses, { profilingEnabled: false });

  // Only scan source when protocol reports clean — avoid extra I/O
  // when protocol already correctly reports holes.
  const needsExplicitHoleScan =
    parsed.success && parsed.goalCount === 0 && parsed.invisibleGoalCount === 0;
  const sourceHoleCount = needsExplicitHoleScan ? countExplicitSourceHoles(absPath) : 0;

  // goalCount must match the actual goals array so consumers can
  // safely index into goals[].  sourceHoleCount feeds hasHoles only.
  const goalCount = parsed.goalCount;
  const hasHoles = goalCount > 0 || parsed.invisibleGoalCount > 0 || sourceHoleCount > 0;
  const strictFallbackTriggered = parsed.success && hasHoles;
  const success = strictFallbackTriggered ? false : parsed.success;
  const classification = success
    ? hasHoles
      ? "ok-with-holes"
      : "ok-complete"
    : "type-error";
  const isComplete = success && !hasHoles;
  const strictRequirement = "Strict load requires zero unresolved metas and zero holes.";
  const strictFallbackError = sourceHoleCount > 0
    ? `Detected ${sourceHoleCount} explicit hole marker(s) in source file; ${strictRequirement}`
    : `Strict load reported unresolved metas/holes; ${strictRequirement}`;
  const errors = strictFallbackTriggered
    ? [...parsed.errors, strictFallbackError]
    : parsed.errors;

  // Set session state atomically AFTER command completes.
  session.currentFile = absPath;
  session.goalIds = parsed.goalIds;
  session.lastLoadedMtime = statSync(absPath).mtimeMs;
  session.lastClassification = classification;
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = parsed.invisibleGoalCount;

  return {
    success,
    errors,
    warnings: parsed.warnings,
    goals: parsed.goals,
    allGoalsText: parsed.allGoalsText,
    invisibleGoalCount: parsed.invisibleGoalCount,
    goalCount,
    hasHoles,
    isComplete,
    classification,
    profiling: parsed.profiling,
    lastCheckedLine: parsed.lastCheckedLine ?? null,
  };
}
