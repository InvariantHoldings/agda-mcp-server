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

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { AgdaSession } from "./session.js";
import type { LoadResult } from "./types.js";
import { NOT_FOUND_RESULT } from "./session-constants.js";
import { parseLoadResponses } from "./parse-load-responses.js";
import { throwOnFatalProtocolStderr } from "./protocol-errors.js";
import { mergeGoals } from "./goal-merging.js";
import { logger } from "./logger.js";
import { command, quoted, profileOptionsList } from "../protocol/command-builder.js";
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

  const goalCount = goals.length;
  const { hasHoles, isComplete, classification } = classifyParsedLoad(parsed, goalCount);

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

  // Set session state atomically AFTER command completes.
  session.currentFile = absPath;
  session.goalIds = parsed.goalIds;
  session.lastLoadedMtime = statSync(absPath).mtimeMs;
  session.lastClassification = parsed.classification;
  session.lastLoadedAt = Date.now();
  session.lastInvisibleGoalCount = parsed.invisibleGoalCount;

  return {
    success: parsed.success,
    errors: parsed.errors,
    warnings: parsed.warnings,
    goals: parsed.goals,
    allGoalsText: parsed.allGoalsText,
    invisibleGoalCount: parsed.invisibleGoalCount,
    goalCount: parsed.goalCount,
    hasHoles: parsed.hasHoles,
    isComplete: parsed.isComplete,
    classification: parsed.classification,
    profiling: parsed.profiling,
    lastCheckedLine: parsed.lastCheckedLine ?? null,
  };
}
