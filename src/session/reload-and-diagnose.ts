// MIT License — see LICENSE
//
// Centralized reload-and-diagnose helper for proof-action tools.
//
// After applying a proof edit (or failing to), the Agda session may be
// out of sync with the on-disk file. This module provides a uniform way
// to reload and surface diagnostics for all proof-action tools.

import type { AgdaSession } from "../agda-process.js";
import { applyProofEdit, applyBatchHoleReplacements } from "./apply-proof-edit.js";
import type { ProofEdit, ApplyEditResult, BatchApplyResult } from "./apply-proof-edit.js";
import type { LoadResult } from "../agda/types.js";
import { projectConfigWarningsText } from "./project-config-diagnostics.js";

// ── Goal-ID diff ────────────────────────────────────────────────────

/**
 * Diff of goal IDs across a reload.
 *
 * - `solved`   — IDs that existed before the reload but not after
 * - `introduced` — IDs that are new after the reload (e.g. subgoals
 *                  produced by refine/case-split)
 * - `remaining` — IDs that exist in both sets
 *
 * Helps agents track goals across edits without having to re-identify
 * by type after every reload. This addresses the §4.3 ask in
 * docs/bug-reports/agent-ux-observations.md — our best-effort version
 * relies on set diff rather than declaration-site identity, which is
 * enough for the common "what disappeared, what appeared" question.
 */
export interface GoalIdDiff {
  solved: number[];
  introduced: number[];
  remaining: number[];
}

export function diffGoalIds(before: number[], after: number[]): GoalIdDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const solved = before.filter((id) => !afterSet.has(id));
  const introduced = after.filter((id) => !beforeSet.has(id));
  const remaining = before.filter((id) => afterSet.has(id));
  return { solved, introduced, remaining };
}

export function formatGoalIdDiff(diff: GoalIdDiff): string {
  const parts: string[] = [];
  if (diff.solved.length > 0) {
    parts.push(`solved ${diff.solved.map((id) => `?${id}`).join(", ")}`);
  }
  if (diff.introduced.length > 0) {
    parts.push(`new ${diff.introduced.map((id) => `?${id}`).join(", ")}`);
  }
  if (parts.length === 0) return "";
  return `Goal diff: ${parts.join("; ")}.\n`;
}

// ── Reload diagnostics ──────────────────────────────────────────────

/**
 * Reload a file and return a human-readable diagnostic summary.
 *
 * Wraps `session.load()` in try/catch so a transient Agda-process
 * failure after a successful file write still returns a usable message
 * rather than propagating an exception.
 *
 * When `goalIdsBefore` is provided, the summary also includes a goal
 * diff (solved / new / remaining) computed by comparing the
 * pre-reload IDs to the post-reload IDs from the session.
 */
export async function reloadAndDiagnose(
  session: AgdaSession,
  filePath: string,
  preamble: string,
  goalIdsBefore?: number[],
): Promise<string> {
  let output = preamble;
  try {
    const loadResult: LoadResult = await session.load(filePath);
    if (loadResult.success) {
      output += `Reloaded: ${loadResult.goalCount} goal(s) remaining.\n`;
    } else {
      output += `Reloaded with errors: ${loadResult.goalCount} goal(s) remaining.\n`;
      if (loadResult.errors.length > 0) {
        output += `**Errors:** ${loadResult.errors.join("; ")}\n`;
      }
    }
    if (loadResult.warnings.length > 0) {
      output += `**Warnings:** ${loadResult.warnings.join("; ")}\n`;
    }
    output += projectConfigWarningsText(loadResult.projectConfigWarnings);
    if (goalIdsBefore !== undefined) {
      const diff = diffGoalIds(goalIdsBefore, session.getGoalIds());
      const formatted = formatGoalIdDiff(diff);
      if (formatted) output += formatted;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output += `**Warning:** Failed to reload/resync session (${msg}). Run \`agda_load\` manually.\n`;
  }
  return output;
}

// ── Staleness guard ─────────────────────────────────────────────────

/**
 * Stale-file guard used before any proof edit. If the on-disk file
 * has a different mtime than the one recorded at last load, the
 * goal IDs captured before the proof action are stale relative to
 * what is on disk, and applying an offset-based edit would silently
 * clobber external changes. Fail loud and instruct the caller to
 * reload.
 *
 * Returns a warning message if stale, or null if safe to proceed.
 */
function stalenessBlockMessage(session: AgdaSession): string | null {
  if (!session.isFileStale()) return null;
  return (
    "\n**Warning:** The loaded file has been modified on disk since " +
    "the last load. Not writing the edit to avoid clobbering external " +
    "changes. Run `agda_load` to refresh, then retry the proof action.\n"
  );
}

// ── Single proof edit + reload ──────────────────────────────────────

/**
 * Apply a proof edit to the file, reload, and return output describing
 * what happened. Handles all failure modes:
 * - File changed on disk (stale): refuses the edit AND reloads the
 *   stale file to resync the session (the proof action already ran
 *   against stale state, so we need to bring the session back to
 *   match disk).
 * - FS exceptions (permissions, missing file): reloads unchanged file to resync
 * - Edit not applied (goal not found): reloads unchanged file to resync
 * - Reload failure after successful write: warns user to `agda_load` manually
 */
export async function applyEditAndReload(
  session: AgdaSession,
  goalIdsBefore: number[],
  edit: ProofEdit,
): Promise<string> {
  const filePath = session.currentFile;
  if (!filePath) {
    // Defense in depth: the proof-action tool wrappers already
    // short-circuit on no-file-loaded, so this branch should be
    // unreachable from them. We still return a visible warning
    // rather than a silent empty string, because a silent "" would
    // be indistinguishable from "everything succeeded and produced
    // no output" on the caller's side.
    return (
      "\n**Warning:** No file is currently loaded, so the edit was " +
      "not applied. Run `agda_load` first.\n"
    );
  }

  const staleMsg = stalenessBlockMessage(session);
  if (staleMsg) {
    // The proof-action command has already mutated Agda's session
    // state (goal IDs, metas, etc.) by the time we check staleness,
    // because goal-tools calls session.goal.give() before
    // applyEditAndReload(). Returning only the warning would leave
    // the session in a post-action state while the on-disk file is
    // still the pre-action version — exactly the desync the tool
    // is supposed to prevent. Reload the stale file to resync the
    // session back to on-disk truth.
    return reloadAndDiagnose(session, filePath, staleMsg);
  }

  let editResult: ApplyEditResult;
  try {
    editResult = await applyProofEdit(filePath, goalIdsBefore, edit);
  } catch (err) {
    // FS error (permissions, missing file, etc.) — the file is unchanged
    // but the Agda session has already mutated. Reload to resync.
    const msg = err instanceof Error ? err.message : String(err);
    const out = await reloadAndDiagnose(
      session, filePath,
      `\n**Warning:** File edit failed: ${msg}\n`,
    );
    return out + `Apply the edit manually, then call \`agda_load\` to reload.\n`;
  }

  if (editResult.applied) {
    return reloadAndDiagnose(
      session, filePath, `\n${editResult.message}\n`, goalIdsBefore,
    );
  }

  // Edit failed — session state is out of sync with the file on disk.
  // Reload the unchanged file to resync.
  const out = await reloadAndDiagnose(
    session, filePath,
    `\n**Warning:** ${editResult.message}\n`,
  );
  return out + `Apply the edit manually, then call \`agda_load\` to reload.\n`;
}

// ── Batch edit + reload ─────────────────────────────────────────────

/**
 * Apply a batch of hole replacements to the file, reload, and return
 * a diagnostic summary. Handles all failure modes symmetrically with
 * `applyEditAndReload`.
 */
export async function applyBatchEditAndReload(
  session: AgdaSession,
  goalIdsBefore: number[],
  filePath: string,
  rawSolutions: Array<{ goalId: number; expr: string }>,
): Promise<string> {
  // `session.isFileStale()` compares the session's currently-loaded
  // file against its recorded mtime; it has no notion of an
  // arbitrary `filePath`. Only run the guard when the batch edit is
  // actually targeting the currently-loaded file, otherwise the
  // warning text would be misleading ("the loaded file changed on
  // disk" when in fact we're editing a different file entirely).
  const staleMsg =
    filePath === session.currentFile ? stalenessBlockMessage(session) : null;
  if (staleMsg) {
    // Same rationale as applyEditAndReload: the batch proof action
    // (SolveAll / SolveOne) already ran against stale session state
    // before we got here, so returning only the warning would leave
    // the session desynced from disk. Reload the stale file to
    // resync.
    return reloadAndDiagnose(session, filePath, staleMsg);
  }

  let batchResult: BatchApplyResult;
  try {
    batchResult = await applyBatchHoleReplacements(filePath, goalIdsBefore, rawSolutions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const out = await reloadAndDiagnose(
      session, filePath,
      `\n**Warning:** Batch edit failed: ${msg}\n`,
    );
    return out + `Apply the edits manually, then call \`agda_load\` to reload.\n`;
  }

  if (batchResult.appliedCount > 0) {
    return reloadAndDiagnose(
      session, filePath, `\n${batchResult.message}\n`, goalIdsBefore,
    );
  }

  // No edits applied — resync session with unchanged file.
  const out = await reloadAndDiagnose(
    session, filePath,
    `\n**Warning:** ${batchResult.message}\n`,
  );
  return out + `Apply the edits manually, then call \`agda_load\` to reload.\n`;
}
