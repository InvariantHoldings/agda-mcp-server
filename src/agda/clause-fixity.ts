// MIT License — see LICENSE
//
// Clause-arity inference (for missing-clause stub generation) and
// fixity-conflict detection (for spotting user-defined operators that
// would bind tighter than expected against a curated list of imported
// stdlib operators). Both are pure and operate on already-loaded
// source strings.

import { splitWords } from "./refactor-helpers.js";

export interface FixityConflict {
  operator: string;
  line: number;
  conflictingOperator: string;
  conflictingPrecedence: number;
  suggestedFixity: string;
}

/**
 * Curated precedence map for common stdlib operators. Used as the
 * default reference set for `inferFixityConflicts`. Numbers match the
 * declarations in `Data.Nat.Properties`, `Data.Bool`, etc., so a
 * user-defined operator without a fixity declaration that binds
 * against any of these will trigger a conflict warning.
 */
const DEFAULT_IMPORTED_FIXITIES: Readonly<Record<string, number>> = {
  "_+_": 6,
  "_-_": 6,
  "_*_": 7,
  "_≤_": 4,
  "_<_": 4,
  "_≡_": 4,
  "_∧_": 3,
  "_∨_": 2,
};

/**
 * Best-effort arity inference for a function name. Tries existing
 * clauses first (count argument tokens before `=`); falls back to
 * the type signature (count `→`/`->` arrows). Returns 1 when nothing
 * matches — generates `name _ = ?` rather than failing.
 */
export function inferMissingClauseArity(source: string, functionName: string): number {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = source.split(/\r?\n/u);

  const clauseRe = new RegExp(`^\\s*${escaped}\\b([^=]*)=`, "u");
  for (const line of lines) {
    const match = clauseRe.exec(line);
    if (!match) continue;
    const args = splitWords(match[1]).filter((token) => token !== "|");
    return args.length;
  }

  const sigRe = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "u");
  for (const line of lines) {
    const match = sigRe.exec(line);
    if (!match) continue;
    const type = match[1];
    const arrows = (type.match(/->|→/gu) ?? []).length;
    return arrows;
  }

  return 1;
}

/** Build a missing-clause stub: `name _ _ ... = ?` with `arity` underscores. */
export function buildMissingClause(functionName: string, arity: number): string {
  if (arity <= 0) return `${functionName} = ?`;
  return `${functionName} ${Array.from({ length: arity }, () => "_").join(" ")} = ?`;
}

/** Parse `infix[lr]? N op1 op2 ...` declarations into `op → precedence`. */
function parseDeclaredFixities(source: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^infix[lr]?\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const precedence = Number.parseInt(match[1], 10);
    for (const symbol of splitWords(match[2])) {
      map.set(symbol, precedence);
    }
  }
  return map;
}

/**
 * True when `line` uses `operator` either as a verbatim substring or,
 * for surface forms like `_+_`, as a separated infix sequence (` + `).
 */
function lineUsesOperator(line: string, operator: string): boolean {
  if (line.includes(operator)) return true;
  if (operator.startsWith("_") && operator.endsWith("_") && operator.length > 2) {
    const surface = operator.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${surface}(\\s|$)`, "u").test(line);
  }
  return false;
}

/**
 * Locate every user-defined operator declaration shaped like
 * `_op_ : ...` or `_op_ ... = ...`. Returns the operator's surface
 * name and the line where it was declared.
 */
function parseUserDefinedOperators(source: string): Array<{ operator: string; line: number }> {
  const ops: Array<{ operator: string; line: number }> = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^\s*(_[^\s]+_)\s*[:=]/u.exec(line);
    if (!match) continue;
    ops.push({ operator: match[1], line: i + 1 });
  }
  return ops;
}

/**
 * Detect user-defined operators that lack a fixity declaration AND
 * appear on a source line alongside an imported operator with a
 * known precedence. Each match becomes a `FixityConflict` with a
 * suggested `infix N op` declaration to silence the warning.
 *
 * `importedFixities` defaults to a curated stdlib reference set;
 * callers can pass their own to extend or replace it.
 */
export function inferFixityConflicts(
  source: string,
  importedFixities: Readonly<Record<string, number>> = DEFAULT_IMPORTED_FIXITIES,
): FixityConflict[] {
  const declared = parseDeclaredFixities(source);
  const ops = parseUserDefinedOperators(source);
  const lines = source.split(/\r?\n/u);
  const conflicts: FixityConflict[] = [];
  const seen = new Set<string>();

  for (const op of ops) {
    if (declared.has(op.operator)) continue;
    for (const [importedOp, importedPrecedence] of Object.entries(importedFixities)) {
      if (importedOp === op.operator) continue;
      for (let i = 0; i < lines.length; i++) {
        if (!lineUsesOperator(lines[i], op.operator) || !lineUsesOperator(lines[i], importedOp)) continue;
        if (20 <= importedPrecedence) continue;
        const key = `${op.operator}:${i + 1}:${importedOp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          operator: op.operator,
          line: i + 1,
          conflictingOperator: importedOp,
          conflictingPrecedence: importedPrecedence,
          suggestedFixity: `infix ${Math.max(0, importedPrecedence)} ${op.operator}`,
        });
      }
    }
  }

  return conflicts.sort((a, b) => a.line - b.line || a.operator.localeCompare(b.operator));
}
