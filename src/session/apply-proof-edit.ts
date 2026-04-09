// MIT License — see LICENSE
//
// Apply proof-action results to an Agda source file.
//
// After a successful Cmd_give, Cmd_refine, Cmd_auto, or Cmd_make_case,
// Agda returns the result expression but does NOT modify the file —
// editors are expected to apply the edit themselves. This module does
// that for MCP clients that have no editor buffer.

import { readFile, writeFile } from "node:fs/promises";
import { findGoalPosition } from "./goal-positions.js";

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
