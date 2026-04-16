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

// ── IOTCM protocol semantics ────────────────────────────────────────
//
// Source of truth: the Agda Haskell sources (consulted across
// v2.7.0.1, v2.8.0, and master/pre-2.9.0):
//
//   Response/Base.hs  — Response_boot, Goals_boot, DisplayInfo_boot
//   JSONTop.hs        — JSON serialisation (EncodeTCM instances)
//
// See also: tooling/protocol/data/official-cross-version-notes.json
//
// The `--interaction-json` protocol distinguishes three kinds of
// "unfinished" items. Our classification must respect all three.
//
// 1. **Visible goals (interaction points)**
//
//    Haskell type: OutputConstraint_boot tcErr A.Expr InteractionId
//    Haskell comment: "visible metas (goals)"
//    JSON responses: `InteractionPoints.interactionPoints` (numeric IDs)
//                    `AllGoalsWarnings.visibleGoals` (with type info)
//
//    These are user-written holes (`{!!}`, `{! expr !}`, `?`). Each
//    gets an `InteractionId` and can be targeted by give / refine /
//    case-split / auto. The shape is stable across v2.7.0.1–2.8.0.
//
// 2. **Invisible goals (unsolved metavariables)**
//
//    Haskell type: OutputConstraint_boot tcErr A.Expr NamedMeta
//    Haskell comment: "hidden (unsolved) metas"
//    JSON response: `AllGoalsWarnings.invisibleGoals`
//
//    Metavariables Agda created during elaboration but could not
//    solve — e.g. unsolved implicit arguments, or inferred types
//    blocked on a user hole.
//
//    Key subtlety: holes inside `abstract` blocks are *not* reported
//    as interaction points (they have no stable InteractionId).
//    Instead they surface only as invisible goals. So a file can have
//    `invisibleGoalCount > 0` *and* `goalCount = 0` even though the
//    source clearly contains `{!!}`.
//
// 3. **Source-level hole markers (our fallback detection)**
//
//    Not from the protocol. When IOTCM reports zero goals *and* zero
//    invisible goals, but the source contains explicit hole markers,
//    the file is not truly complete. This guards against edge cases
//    where Agda optimises away a hole's interaction point. Gated
//    behind `(success && goalCount === 0 && invisibleGoalCount === 0)`
//    to avoid redundant I/O in the common path.
//
// Postulates are *not* holes. They are accepted as complete
// definitions and never appear in visibleGoals or invisibleGoals.
//
// `Cmd_load_no_metas` is strictly stronger than `Cmd_load`: it
// requires zero unresolved metavariables, so any remaining
// interaction points, invisible goals, or source-level hole markers
// force a type-error classification.

/**
 * Classify a load result considering protocol-reported goals,
 * invisible goals (unsolved metas), and source-level hole markers.
 *
 * `goalCount` must equal the actual `goals[]` array length so callers
 * can safely index into it. `sourceHoleCount` is the number of hole
 * markers found by scanning the source; it feeds into `hasHoles` for
 * classification but does not inflate `goalCount`.
 */
function classifyLoadResult(input: {
  success: boolean;
  goalCount: number;
  invisibleGoalCount: number;
  sourceHoleCount: number;
}): {
  hasHoles: boolean;
  isComplete: boolean;
  classification: string;
} {
  const hasHoles =
    input.goalCount > 0 ||
    input.invisibleGoalCount > 0 ||
    input.sourceHoleCount > 0;
  const isComplete = input.success && !hasHoles;
  const classification = input.success
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
  const { hasHoles, isComplete, classification } = classifyLoadResult({
    success: parsed.success,
    goalCount,
    invisibleGoalCount: parsed.invisibleGoalCount,
    sourceHoleCount,
  });

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
  const { hasHoles } = classifyLoadResult({
    success: parsed.success,
    goalCount,
    invisibleGoalCount: parsed.invisibleGoalCount,
    sourceHoleCount,
  });

  // Cmd_load_no_metas is strictly stronger: any remaining interaction
  // points, invisible goals (unsolved metas), or source-level hole
  // markers force a failure. See the IOTCM protocol notes above.
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
    ? `Detected ${sourceHoleCount} hole marker(s) in source file; ${strictRequirement}`
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
