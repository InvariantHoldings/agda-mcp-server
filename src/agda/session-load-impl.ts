// MIT License — see LICENSE
//
// AgdaSession.load() / loadNoMetas() as free functions over a session
// reference: Cmd_load → parse → reconcile → session-state update →
// result. They mutate session load-state fields as a deliberate side
// effect (readable via public getters). Helpers live in
// session-load-helpers.ts to keep this file under the size ceiling.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { AgdaSession } from "./session.js";
import type { LoadResult } from "./types.js";
import { parseLoadResponses, type ParsedLoadResult } from "./parse-load-responses.js";
import { throwOnFatalProtocolStderr } from "./protocol-errors.js";
import { logger } from "./logger.js";
import { command, quoted } from "../protocol/command-builder.js";
import {
  buildLoadOptionsList,
  classifyLoadResult,
  countExplicitSourceHoles,
  fileNotFound,
  invalidatePriorLoadState,
  loadFailedAfterReconciliation,
  reconcileGoalsViaMetas,
} from "./session-load-helpers.js";

export { buildLoadOptionsList };

// ── IOTCM goal taxonomy (drives classification) ─────────────────────
// Source: Agda Response/Base.hs + JSONTop.hs (v2.7.0.1–pre-2.9.0); see
// tooling/protocol/data/official-cross-version-notes.json.
//
//  1. Visible goals — user holes ({!!}, ?). Reported as
//     InteractionPoints (numeric IDs) + AllGoalsWarnings.visibleGoals.
//  2. Invisible goals — unsolved metas Agda couldn't solve. Reported as
//     AllGoalsWarnings.invisibleGoals. Holes inside `abstract` blocks
//     have no InteractionId, so a file can have invisibleGoalCount > 0
//     yet goalCount = 0 despite visible {!!} in source.
//  3. Source hole markers — our fallback scan when the protocol reports
//     zero visible and zero invisible goals but the source has {!!}/?.
//
// Postulates are complete, not holes. Cmd_load_no_metas is stricter:
// any remaining interaction point, invisible goal, or source hole forces
// a type-error.

/** Record an early-return classification on the session and return the
 *  result. Keeps the proc-died / incomplete exits consistent with the
 *  "lastClassification set on every load attempt" contract. */
function finalizeEarlyReturn(session: AgdaSession, result: LoadResult): LoadResult {
  session.lastClassification = result.classification;
  session.lastLoadedAt = Date.now();
  return result;
}

export async function runLoad(
  session: AgdaSession,
  filePath: string,
  options?: { profileOptions?: string[]; commandLineOptions?: string[] },
): Promise<LoadResult> {
  // Invalidate prior success before anything else so a throwing,
  // incomplete, missing-file, or invalid-options attempt can't leave the
  // previous load's clean state visible, and record every early return so
  // lastClassification reflects this attempt.
  invalidatePriorLoadState(session);

  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return finalizeEarlyReturn(session, fileNotFound(absPath));
  }

  const optsBuild = buildLoadOptionsList(options?.profileOptions, options?.commandLineOptions);
  if (!optsBuild.ok) {
    return finalizeEarlyReturn(session, optsBuild.result);
  }

  // iotcmFor uses absPath directly — don't set currentFile yet, since
  // ensureProcess() (inside sendCommand) would reset it. awaitGoalTerminus
  // tells the transport not to treat this load as complete until Agda has
  // emitted its goal-state responses (InteractionPoints + AllGoalsWarnings,
  // or an Error) — so a slow module that type-checks silently for seconds
  // can't be resolved mid-check and mis-read as a clean load.
  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load", quoted(absPath), optsBuild.optsList)),
    undefined,
    { awaitGoalTerminus: true },
  );
  throwOnFatalProtocolStderr(responses);
  const parsed = parseLoadResponses(responses, { profilingEnabled: optsBuild.profilingEnabled });

  // The transport waits for Agda's goal-state responses, so their absence
  // means the process ended before finishing this load. Fail loudly rather
  // than report a fabricated success.
  if (!parsed.sawLoadTerminus) {
    throw new Error(
      `Agda process ended before completing the load of ${absPath} ` +
      `(no goals or type error were emitted). Re-issue agda_load.`,
    );
  }

  // Set session state before reconciling metas so follow-up queries run.
  session.currentFile = absPath;
  session.goalIds = parsed.goalIds;
  session.lastLoadedMtime = statSync(absPath).mtimeMs;

  let goals = parsed.goals;
  let goalIds = parsed.goalIds;

  if (parsed.success) {
    const reconciled = await reconcileGoalsViaMetas(session, absPath, parsed.goals);
    goals = reconciled.goals;
    goalIds = reconciled.goalIds;
    // metas killed the proc: sendCommand's finally cleared state, so a
    // success envelope here would lie. Surface the failure instead.
    if (reconciled.procDied) {
      return finalizeEarlyReturn(
        session,
        loadFailedAfterReconciliation(absPath, parsed.warnings, parsed.profiling),
      );
    }
  }

  // Scan for source holes only when the protocol looks clean — the
  // fallback for holes inside `abstract` blocks that Agda under-reports as
  // interaction points. Avoids I/O on modules the protocol already covered.
  const needsExplicitHoleScan =
    parsed.success && goals.length === 0 && parsed.invisibleGoalCount === 0;
  const sourceHoleCount = needsExplicitHoleScan ? countExplicitSourceHoles(absPath) : 0;

  // goalCount tracks the goals[] length; sourceHoleCount feeds hasHoles.
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
  invalidatePriorLoadState(session);

  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return finalizeEarlyReturn(session, fileNotFound(absPath));
  }

  // No awaitGoalTerminus / terminus guard here: Cmd_load_no_metas
  // deliberately skips the metas display, so a clean strict load emits no
  // InteractionPoints / AllGoalsWarnings at all (only highlighting +
  // Status). It's outside the documented Cmd_load goal-state sequence, so
  // "no terminus" is normal completion, not truncation.
  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load_no_metas", quoted(absPath))),
  );
  throwOnFatalProtocolStderr(responses);
  const parsed: ParsedLoadResult = parseLoadResponses(responses, { profilingEnabled: false });

  const needsExplicitHoleScan =
    parsed.success && parsed.goalCount === 0 && parsed.invisibleGoalCount === 0;
  const sourceHoleCount = needsExplicitHoleScan ? countExplicitSourceHoles(absPath) : 0;

  const goalCount = parsed.goalCount;
  const { hasHoles } = classifyLoadResult({
    success: parsed.success,
    goalCount,
    invisibleGoalCount: parsed.invisibleGoalCount,
    sourceHoleCount,
  });

  // Strict: any remaining interaction point, invisible goal, or source
  // hole forces failure. success=true here therefore implies no holes,
  // so only ok-complete / type-error are reachable.
  const strictFallbackTriggered = parsed.success && hasHoles;
  const success = strictFallbackTriggered ? false : parsed.success;
  const classification = success ? "ok-complete" : "type-error";
  const isComplete = success;
  const strictRequirement = "Strict load requires zero unresolved metas and zero holes.";
  const strictFallbackError = sourceHoleCount > 0
    ? `Detected ${sourceHoleCount} hole marker(s) in source file; ${strictRequirement}`
    : `Strict load reported unresolved metas/holes; ${strictRequirement}`;
  const errors = strictFallbackTriggered
    ? [...parsed.errors, strictFallbackError]
    : parsed.errors;

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
