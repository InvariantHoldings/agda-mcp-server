// MIT License — see LICENSE
//
// Apply proof-action results to an Agda source file.
//
// After a successful Cmd_give, Cmd_refine, Cmd_auto, or Cmd_make_case,
// Agda returns the result expression but does NOT modify the file —
// editors are expected to apply the edit themselves. This module does
// that for MCP clients that have no editor buffer.

import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { findGoalPosition, findGoalPositions } from "./goal-positions.js";

/**
 * Write `content` to `filePath` atomically via temp-file-rename.
 *
 * `fs.writeFile` truncates and rewrites the target in place: a
 * reader that opens the file mid-write can see a truncated or
 * partially-written state. We instead write to a sibling temp file
 * and `rename()` it over the target, which is atomic on POSIX and
 * NTFS when both paths are on the same filesystem.
 *
 * On failure we attempt to unlink the temp file so we don't leak
 * `.agda-mcp-tmp-*` turds next to user sources. Unlink errors are
 * swallowed because the primary write error is more interesting.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  // Same-directory temp file so rename() stays on one filesystem.
  const tmpPath = `${filePath}.agda-mcp-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup failure — the real error is more informative.
    }
    throw err;
  }
}

// ── Edit types ───────────────────────────────────────────────────────

export interface ReplaceHoleEdit {
  kind: "replace-hole";
  /** The goal ID whose hole marker is being replaced. */
  goalId: number;
  /** The expression to substitute for the hole. */
  expr: string;
}

export interface ReplaceLineEdit {
  kind: "replace-line";
  /** The goal ID on the line being replaced. */
  goalId: number;
  /** The new clause lines that replace the original line. */
  clauses: string[];
}

export type ProofEdit = ReplaceHoleEdit | ReplaceLineEdit;

// ── Result ───────────────────────────────────────────────────────────

export interface ApplyEditResult {
  /** Whether the edit was successfully applied. */
  applied: boolean;
  /** The file path that was modified (or would have been). */
  filePath: string;
  /** Human-readable description of what happened. */
  message: string;
}

// ── Batch result ─────────────────────────────────────────────────────

export interface BatchApplyResult {
  appliedCount: number;
  failedGoalIds: number[];
  message: string;
}

/**
 * Apply multiple hole replacements to an Agda source file in one pass.
 *
 * Replacements are applied back-to-front (reverse offset order) so that
 * earlier offsets remain valid after each substitution.
 *
 * Returns the count of applied replacements, a list of goal IDs that
 * could not be located, and a summary message.
 */
export async function applyBatchHoleReplacements(
  filePath: string,
  goalIds: number[],
  replacements: Array<{ goalId: number; expr: string }>,
): Promise<BatchApplyResult> {
  const source = await readFile(filePath, "utf-8");
  const allPositions = findGoalPositions(source);

  const edits: Array<{ start: number; end: number; expr: string; goalId: number }> = [];
  const failedGoalIds: number[] = [];
  const seenGoalIds = new Set<number>();

  for (const { goalId, expr } of replacements) {
    // Deduplicate: if the same goalId appears more than once, keep
    // only the first replacement to prevent corrupting file offsets.
    if (seenGoalIds.has(goalId)) continue;
    seenGoalIds.add(goalId);

    const index = goalIds.indexOf(goalId);
    if (index < 0 || index >= allPositions.length) {
      failedGoalIds.push(goalId);
      continue;
    }
    const pos = allPositions[index];
    edits.push({ start: pos.startOffset, end: pos.endOffset, expr, goalId });
  }

  if (edits.length === 0) {
    return {
      appliedCount: 0,
      failedGoalIds,
      message:
        failedGoalIds.length > 0
          ? `Could not locate goals ${failedGoalIds.map((id) => `?${id}`).join(", ")} in file — the file may have been modified since last load.`
          : "No replacements to apply.",
    };
  }

  // Apply in reverse offset order: modifying later positions first keeps
  // earlier offsets valid for subsequent replacements.
  edits.sort((a, b) => b.start - a.start);

  let newSource = source;
  for (const edit of edits) {
    newSource = newSource.slice(0, edit.start) + edit.expr + newSource.slice(edit.end);
  }

  await writeFileAtomic(filePath, newSource);

  const failedMsg =
    failedGoalIds.length > 0
      ? ` (could not locate ${failedGoalIds.map((id) => `?${id}`).join(", ")})`
      : "";
  return {
    appliedCount: edits.length,
    failedGoalIds,
    message: `Applied ${edits.length} solution(s) to file${failedMsg}.`,
  };
}

// ── Free-form text edit ─────────────────────────────────────────────

export interface TextEditResult {
  /** Whether the edit was applied to the file. */
  applied: boolean;
  /** Number of occurrences of `oldText` found in the source. */
  occurrences: number;
  /** 1-based line number where the edit was applied, if any. */
  line: number | null;
  /** Human-readable description. */
  message: string;
}

/**
 * Apply a targeted text substitution to a file on disk.
 *
 * Used by the `agda_apply_edit` tool for edits that aren't goal
 * actions — e.g. adding an import, renaming a symbol, fixing a
 * typo. The caller is expected to reload the file afterwards to
 * resync the Agda session with the new on-disk state.
 *
 * Contract:
 * - By default, `oldText` must match exactly once (fails if 0 or >1).
 * - Pass `occurrence: n` (1-based) to target a specific match when
 *   there are duplicates.
 * - Line-ending normalization: LLMs generate `oldText` / `newText`
 *   with `\n` line endings even when the file uses CRLF. Before
 *   searching we detect the file's dominant EOL; if it is CRLF we
 *   promote bare `\n` in both `oldText` and `newText` to `\r\n`
 *   (but leave existing `\r\n` sequences untouched, so a caller
 *   that already matches the file's style still works). This
 *   keeps writes self-consistent with the file's EOL style.
 * - The file is written via `writeFileAtomic` (temp file + rename),
 *   so concurrent readers never observe a truncated or half-written
 *   state. The rename is atomic on POSIX and NTFS when both paths
 *   are on the same filesystem, which is always true here because
 *   the temp path is a sibling of the target.
 * - The file is NOT reloaded here — that's the caller's job.
 */
export async function applyTextEdit(
  filePath: string,
  oldText: string,
  newText: string,
  options: { occurrence?: number } = {},
): Promise<TextEditResult> {
  if (oldText.length === 0) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: "oldText must not be empty.",
    };
  }

  const source = await readFile(filePath, "utf-8");

  // Normalize oldText/newText to match the file's dominant EOL style.
  // If the file is CRLF, any bare \n (not already part of \r\n) in the
  // caller-provided strings is promoted to \r\n. This makes LF-authored
  // inputs match CRLF files without surprising the caller.
  const fileUsesCrlf = source.includes("\r\n");
  const normalizeEol = (s: string): string =>
    fileUsesCrlf ? s.replace(/(?<!\r)\n/g, "\r\n") : s;
  const searchText = normalizeEol(oldText);
  const replacementText = normalizeEol(newText);

  // Count occurrences
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = source.indexOf(searchText, searchFrom);
    if (idx === -1) break;
    occurrences.push(idx);
    searchFrom = idx + searchText.length;
  }

  if (occurrences.length === 0) {
    return {
      applied: false,
      occurrences: 0,
      line: null,
      message: `oldText not found in file.`,
    };
  }

  const { occurrence } = options;
  let targetIndex: number;

  if (occurrence !== undefined) {
    if (occurrence < 1 || occurrence > occurrences.length) {
      return {
        applied: false,
        occurrences: occurrences.length,
        line: null,
        message: `Occurrence ${occurrence} requested but only ${occurrences.length} match(es) exist.`,
      };
    }
    targetIndex = occurrences[occurrence - 1];
  } else {
    if (occurrences.length > 1) {
      return {
        applied: false,
        occurrences: occurrences.length,
        line: null,
        message: `oldText matches ${occurrences.length} locations; pass \`occurrence\` (1..${occurrences.length}) to disambiguate.`,
      };
    }
    targetIndex = occurrences[0];
  }

  const newSource =
    source.slice(0, targetIndex) + replacementText + source.slice(targetIndex + searchText.length);

  await writeFileAtomic(filePath, newSource);

  // Compute 1-based line number of the edit start
  let line = 1;
  for (let i = 0; i < targetIndex; i++) {
    if (source[i] === "\n") line++;
  }

  return {
    applied: true,
    occurrences: occurrences.length,
    line,
    message: `Applied edit at line ${line}${occurrences.length > 1 ? ` (occurrence ${occurrence})` : ""}.`,
  };
}

// ── Apply logic ──────────────────────────────────────────────────────

/**
 * Apply a proof-action edit to an Agda source file on disk.
 *
 * For ReplaceHole: replaces the {! !} or ? marker with the expression.
 * For ReplaceLine: replaces the entire line containing the goal with
 * the new clause lines (used for case split).
 *
 * Returns a result indicating whether the edit was applied.
 */
export async function applyProofEdit(
  filePath: string,
  goalIds: number[],
  edit: ProofEdit,
): Promise<ApplyEditResult> {
  const source = await readFile(filePath, "utf-8");

  const pos = findGoalPosition(source, edit.goalId, goalIds);
  if (!pos) {
    return {
      applied: false,
      filePath,
      message: `Could not locate goal ?${edit.goalId} in file — the file may have been modified since last load.`,
    };
  }

  let newSource: string;

  switch (edit.kind) {
    case "replace-hole": {
      // Replace the hole marker with the expression
      newSource =
        source.slice(0, pos.startOffset) +
        edit.expr +
        source.slice(pos.endOffset);
      break;
    }

    case "replace-line": {
      // Detect the file's newline style for consistent line endings
      const eol = source.includes("\r\n") ? "\r\n" : "\n";

      // Find the full line(s) containing the goal marker.
      // For case split, we replace the entire clause line.
      const lineStart = source.lastIndexOf("\n", pos.startOffset) + 1;
      let lineEnd = source.indexOf("\n", pos.endOffset);
      if (lineEnd === -1) lineEnd = source.length;
      // Include the \r before \n if present (CRLF)
      if (lineEnd > 0 && source[lineEnd - 1] === "\r") lineEnd--;

      // Detect indentation of the original line
      const originalLine = source.slice(lineStart, lineEnd);
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";

      // Indent each new clause to match the original
      const indentedClauses = edit.clauses.map((clause) => {
        // If the clause already has indentation, use it as-is;
        // otherwise prepend the detected indent.
        if (clause.startsWith(" ") || clause.startsWith("\t")) {
          return clause;
        }
        return indent + clause;
      });

      newSource =
        source.slice(0, lineStart) +
        indentedClauses.join(eol) +
        source.slice(lineEnd);
      break;
    }
  }

  await writeFileAtomic(filePath, newSource);

  return {
    applied: true,
    filePath,
    message:
      edit.kind === "replace-hole"
        ? `Replaced goal ?${edit.goalId} with \`${edit.expr}\` in file.`
        : `Replaced clause at goal ?${edit.goalId} with ${edit.clauses.length} new clause(s) in file.`,
  };
}
