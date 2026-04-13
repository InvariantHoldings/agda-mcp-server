// MIT License — see LICENSE
//
// Apply proof-action results to an Agda source file.
//
// After a successful Cmd_give, Cmd_refine, Cmd_auto, or Cmd_make_case,
// Agda returns the result expression but does NOT modify the file —
// editors are expected to apply the edit themselves. This module does
// that for MCP clients that have no editor buffer.

import { readFile, writeFile } from "node:fs/promises";
import { findGoalPosition, findGoalPositions } from "./goal-positions.js";

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

  await writeFile(filePath, newSource, "utf-8");

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

  await writeFile(filePath, newSource, "utf-8");

  return {
    applied: true,
    filePath,
    message:
      edit.kind === "replace-hole"
        ? `Replaced goal ?${edit.goalId} with \`${edit.expr}\` in file.`
        : `Replaced clause at goal ?${edit.goalId} with ${edit.clauses.length} new clause(s) in file.`,
  };
}
