// MIT License — see LICENSE
//
// Goal-based edit applicator (the engine behind `agda_give`,
// `agda_refine`, `agda_intro`, `agda_solve_one`, and `agda_case_split`).
// Distinguished from text edits and batch edits because the caller
// addresses the edit by goal ID, and the implementation uses
// `findGoalPosition` to locate the corresponding hole marker by
// scanning the source.

import { findGoalPosition } from "./goal-positions.js";
import {
  MAX_AGDA_SOURCE_BYTES,
  loadSourceForEdit,
  writeFileAtomic,
} from "./safe-source-io.js";

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

/**
 * Apply a proof-action edit to an Agda source file on disk.
 *
 * For `replace-hole`: replaces the `{! !}` or `?` marker with the
 * expression.
 *
 * For `replace-line`: replaces the entire line containing the goal with
 * the new clause lines (used for case split). If the hole spans
 * multiple lines (e.g. `{! multi\n line !}`), the edit wipes
 * everything from the start of the opening line to the end of the
 * closing line. This is acceptable for Agda's `Cmd_make_case` because
 * that command is only invoked on single-line function clauses in
 * practice — we pin the behavior in tests rather than assert on the
 * single-line shape.
 *
 * Returns a result indicating whether the edit was applied.
 */
export async function applyProofEdit(
  filePath: string,
  goalIds: number[],
  edit: ProofEdit,
): Promise<ApplyEditResult> {
  const loadResult = await loadSourceForEdit(filePath);
  if (!loadResult.ok) {
    return {
      applied: false,
      filePath,
      message: `Could not read file (${loadResult.code}): ${loadResult.message}`,
    };
  }
  const source = loadResult.source;

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

  // Same post-edit cap as applyTextEdit: a huge expression or
  // huge clause array could inflate the file past the cap.
  if (Buffer.byteLength(newSource, "utf-8") > MAX_AGDA_SOURCE_BYTES) {
    return {
      applied: false,
      filePath,
      message:
        `Edit result exceeds the ${MAX_AGDA_SOURCE_BYTES}-byte ` +
        `Agda-source cap; refusing to write.`,
    };
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
