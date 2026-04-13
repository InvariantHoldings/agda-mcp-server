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

// ── Reload diagnostics ──────────────────────────────────────────────

/**
 * Reload a file and return a human-readable diagnostic summary.
 *
 * Wraps `session.load()` in try/catch so a transient Agda-process
 * failure after a successful file write still returns a usable message
 * rather than propagating an exception.
 */
export async function reloadAndDiagnose(
  session: AgdaSession,
  filePath: string,
  preamble: string,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output += `**Warning:** Failed to reload/resync session (${msg}). Run \`agda_load\` manually.\n`;
  }
  return output;
}

// ── Single proof edit + reload ──────────────────────────────────────

/**
 * Apply a proof edit to the file, reload, and return output describing
 * what happened. Handles all failure modes:
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
  if (!filePath) return "";

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
    return reloadAndDiagnose(session, filePath, `\n${editResult.message}\n`);
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
    return reloadAndDiagnose(session, filePath, `\n${batchResult.message}\n`);
  }

  // No edits applied — resync session with unchanged file.
  const out = await reloadAndDiagnose(
    session, filePath,
    `\n**Warning:** ${batchResult.message}\n`,
  );
  return out + `Apply the edits manually, then call \`agda_load\` to reload.\n`;
}
