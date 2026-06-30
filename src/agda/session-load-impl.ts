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
  loadIncompleteNoTerminus,
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
  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return fileNotFound(absPath);
  }

  const optsBuild = buildLoadOptionsList(options?.profileOptions, options?.commandLineOptions);
  if (!optsBuild.ok) {
    return optsBuild.result;
  }

  // Invalidate prior success up front so a throwing/incomplete load
  // can't leave stale clean state.
  invalidatePriorLoadState(session);

  // iotcmFor uses absPath directly — don't set currentFile yet, since
  // ensureProcess() (inside sendCommand) would reset it.
  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load", quoted(absPath), optsBuild.optsList)),
  );
  throwOnFatalProtocolStderr(responses);
  const parsed = parseLoadResponses(responses, { profilingEnabled: optsBuild.profilingEnabled });

  // No terminal event → truncated stream → success is untrustworthy
  // success is untrustworthy.
  if (!parsed.sawLoadTerminus) {
    return finalizeEarlyReturn(
      session,
      loadIncompleteNoTerminus(absPath, parsed.warnings, parsed.profiling),
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

  // Scan for source holes only when the protocol looks clean — avoids
  // I/O on large modules whose holes the protocol already reported.
  const needsExplicitHoleScan =
    parsed.success && goals.length === 0 && parsed.invisibleGoalCount === 0;
  const sourceHoleCount = needsExplicitHoleScan ? countExplicitSourceHoles(absPath) : 0;

  // Recovery: source has a hole but we captured no goal IDs —
  // the load stream dropped the interaction points. Re-query a settled
  // Agda. Only adds IDs (never removes), so a genuinely invisible hole
  // correctly stays at zero visible goals.
  if (sourceHoleCount > 0) {
    const recovered = await reconcileGoalsViaMetas(session, absPath, goals);
    if (recovered.procDied) {
      return finalizeEarlyReturn(
        session,
        loadFailedAfterReconciliation(absPath, parsed.warnings, parsed.profiling),
      );
    }
    if (recovered.goals.length > goals.length) {
      goals = recovered.goals;
      goalIds = recovered.goalIds;
    }
  }

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
  const absPath = resolve(session.repoRoot, filePath);
  if (!existsSync(absPath)) {
    return fileNotFound(absPath);
  }

  invalidatePriorLoadState(session);

  const responses = await session.sendCommand(
    session.iotcmFor(absPath, command("Cmd_load_no_metas", quoted(absPath))),
  );
  throwOnFatalProtocolStderr(responses);
  const parsed: ParsedLoadResult = parseLoadResponses(responses, { profilingEnabled: false });

  // No terminal event → truncated stream.
  if (!parsed.sawLoadTerminus) {
    return finalizeEarlyReturn(
      session,
      loadIncompleteNoTerminus(absPath, parsed.warnings, parsed.profiling),
    );
  }

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
