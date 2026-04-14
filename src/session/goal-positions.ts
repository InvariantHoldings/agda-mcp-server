// MIT License — see LICENSE
//
// Scan an Agda source file for goal markers ({! !}, {!!}, ?) and return
// their positions. Agda assigns goal IDs in file-order (left-to-right,
// top-to-bottom), so the Nth marker corresponds to the Nth goal ID from
// the InteractionPoints response.

export interface GoalPosition {
  /** 0-based UTF-16 code-unit offset of the start of the hole marker in `source`. */
  startOffset: number;
  /** 0-based UTF-16 code-unit offset past the end of the hole marker in `source`. */
  endOffset: number;
  /** 0-based line number. */
  line: number;
  /** 0-based column number. */
  column: number;
  /** The raw marker text (e.g. "{!!}", "{! expr !}", "?"). */
  markerText: string;
}

// ── Scan state ─────────────────────────────────────────────────────

/**
 * Mutable scan state passed between the top-level scanner and the
 * skip helpers (`skipLineComment`, `skipBlockComment`, etc.). Holding
 * the cursor, line, and lineStart together lets each helper advance
 * them consistently without returning a tuple.
 */
interface ScanState {
  i: number;
  line: number;
  lineStart: number;
}

/** If `source[st.i]` is a `\n`, advance the line counter. */
function bumpLineIfNewline(source: string, st: ScanState): void {
  if (source[st.i] === "\n") {
    st.line++;
    st.lineStart = st.i + 1;
  }
}

/**
 * Skip an Agda line comment starting at `st.i` (`-- ... \n`).
 * Returns `true` and advances `st` to the character after the
 * newline (or EOF) if a line comment was matched; otherwise returns
 * `false` without touching `st`.
 */
function skipLineComment(source: string, st: ScanState): boolean {
  if (source[st.i] !== "-" || source[st.i + 1] !== "-") return false;
  while (st.i < source.length && source[st.i] !== "\n") st.i++;
  return true;
}

/**
 * Skip an Agda nested block comment starting at `st.i` (`{- ... -}`).
 * Returns `true` and advances `st` past the closing `-}` (or EOF) if
 * a block comment was matched; otherwise returns `false`.
 */
function skipBlockComment(source: string, st: ScanState): boolean {
  if (source[st.i] !== "{" || source[st.i + 1] !== "-") return false;
  let depth = 1;
  st.i += 2;
  while (st.i < source.length && depth > 0) {
    if (source[st.i] === "{" && source[st.i + 1] === "-") {
      depth++;
      st.i += 2;
    } else if (source[st.i] === "-" && source[st.i + 1] === "}") {
      depth--;
      st.i += 2;
    } else {
      bumpLineIfNewline(source, st);
      st.i++;
    }
  }
  return true;
}

/**
 * Skip a double-quoted string literal starting at `st.i` (`"..."`,
 * including `\"` escapes). Returns `true` and advances past the
 * closing quote (or EOF) if a string was matched; otherwise `false`.
 */
function skipStringLiteral(source: string, st: ScanState): boolean {
  if (source[st.i] !== '"') return false;
  st.i++;
  while (st.i < source.length && source[st.i] !== '"') {
    if (source[st.i] === "\\") st.i++; // skip next char (escape)
    bumpLineIfNewline(source, st);
    st.i++;
  }
  if (st.i < source.length) st.i++; // closing quote
  return true;
}

/**
 * Skip an Agda character literal starting at `st.i` (`'a'`, `'\n'`,
 * etc.). Returns `true` and advances past the closing quote if a
 * char literal was matched; otherwise `false`. Leaves `st` alone on
 * non-match so the top-level scanner can keep looking.
 */
function skipCharLiteral(source: string, st: ScanState): boolean {
  if (source[st.i] !== "'" || st.i + 2 >= source.length) return false;
  // Escaped: '\n', '\t', '\\' — requires 4 chars total.
  if (source[st.i + 1] === "\\" && st.i + 3 < source.length && source[st.i + 3] === "'") {
    st.i += 4;
    return true;
  }
  // Simple: 'a', '?', '0' — 3 chars total.
  if (source[st.i + 1] !== "'" && source[st.i + 2] === "'") {
    st.i += 3;
    return true;
  }
  return false;
}

// ── Unicode-aware identifier detection ────────────────────────────

/**
 * Agda identifier characters are anything that is NOT whitespace and
 * NOT one of these reserved delimiters: `.` `;` `{` `}` `(` `)` `@`
 * `"` `'`. Everything else — including astral-plane mathematical
 * symbols like `𝟘`, `𝒇`, or emoji — is a legal identifier char.
 *
 * The `u` flag makes `\s` match Unicode whitespace (e.g. U+00A0
 * NBSP) and lets `String.fromCodePoint` accept full code points.
 */
const DELIMITER_RE = /^[\s.;{}()@"']$/u;

function isIdentCodePoint(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  return !DELIMITER_RE.test(String.fromCodePoint(cp));
}

/**
 * Return the Unicode code point of the character immediately before
 * `i` in `source`, or `undefined` at the start of the string. Handles
 * surrogate pairs: if `source[i-1]` is a low surrogate, the real
 * character starts at `i-2`.
 */
function codePointBefore(source: string, i: number): number | undefined {
  if (i <= 0) return undefined;
  const lowCode = source.charCodeAt(i - 1);
  if (lowCode >= 0xdc00 && lowCode <= 0xdfff && i >= 2) {
    return source.codePointAt(i - 2);
  }
  return source.codePointAt(i - 1);
}

/**
 * Return the Unicode code point of the character starting at `i`, or
 * `undefined` at EOF. `String.prototype.codePointAt` already handles
 * surrogate pairs when called on the high surrogate position.
 */
function codePointAtSafe(source: string, i: number): number | undefined {
  if (i >= source.length) return undefined;
  return source.codePointAt(i);
}

// ── Main scanner ───────────────────────────────────────────────────

/**
 * Find all goal (hole) positions in an Agda source string.
 *
 * Recognized patterns:
 * - `{! ... !}` — explicit interaction hole, possibly with contents
 * - `{!!}`      — empty explicit hole
 * - `?`         — question-mark hole (must be a standalone token, not
 *                 inside an identifier or comment)
 *
 * Returns positions in file order, matching Agda's goal-ID assignment.
 */
export function findGoalPositions(source: string): GoalPosition[] {
  const positions: GoalPosition[] = [];
  const st: ScanState = { i: 0, line: 0, lineStart: 0 };

  while (st.i < source.length) {
    if (skipLineComment(source, st)) continue;
    if (skipBlockComment(source, st)) continue;
    if (skipStringLiteral(source, st)) continue;
    if (skipCharLiteral(source, st)) continue;

    // Match {! ... !} interaction holes
    if (source[st.i] === "{" && source[st.i + 1] === "!") {
      const start = st.i;
      const col = st.i - st.lineStart;
      const startLine = st.line;
      const rewindState: ScanState = { i: st.i, line: st.line, lineStart: st.lineStart };
      st.i += 2; // skip {!

      // Find matching !}, skipping strings and comments inside
      // hole contents via the shared helpers.
      let depth = 1;
      while (st.i < source.length && depth > 0) {
        if (source[st.i] === "{" && source[st.i + 1] === "!") {
          depth++;
          st.i += 2;
          continue;
        }
        if (source[st.i] === "!" && source[st.i + 1] === "}") {
          depth--;
          st.i += 2;
          continue;
        }
        if (skipLineComment(source, st)) continue;
        if (skipBlockComment(source, st)) continue;
        if (skipStringLiteral(source, st)) continue;
        if (skipCharLiteral(source, st)) continue;
        bumpLineIfNewline(source, st);
        st.i++;
      }

      // Unterminated hole safety: if we ran to EOF with depth > 0
      // the source is malformed (agent mid-edit, corrupt file). We
      // MUST NOT record a "hole" that stretches to EOF — a follow-up
      // applyProofEdit would then replace everything from `{!` to
      // EOF, catastrophically. Rewind the scan state and skip past
      // the stray `{!` so the rest of the file can still be scanned.
      if (depth > 0) {
        st.i = rewindState.i + 2;
        st.line = rewindState.line;
        st.lineStart = rewindState.lineStart;
        continue;
      }

      positions.push({
        startOffset: start,
        endOffset: st.i,
        line: startLine,
        column: col,
        markerText: source.slice(start, st.i),
      });
      continue;
    }

    // Match ? question-mark holes — standalone only.
    if (source[st.i] === "?") {
      const prevCp = codePointBefore(source, st.i);
      const nextCp = codePointAtSafe(source, st.i + 1);
      const prevOk = !isIdentCodePoint(prevCp);
      const nextOk = !isIdentCodePoint(nextCp);

      if (prevOk && nextOk) {
        positions.push({
          startOffset: st.i,
          endOffset: st.i + 1,
          line: st.line,
          column: st.i - st.lineStart,
          markerText: "?",
        });
        st.i++;
        continue;
      }
    }

    bumpLineIfNewline(source, st);
    st.i++;
  }

  return positions;
}

/**
 * Find the position of a specific goal by ID.
 * Goal IDs are assigned in file order, so goalId N corresponds to the
 * Nth marker found (0-indexed).
 */
export function findGoalPosition(
  source: string,
  goalId: number,
  goalIds: number[],
): GoalPosition | null {
  const positions = findGoalPositions(source);
  // goalIds maps the session's goal ID array to file-order indices
  const index = goalIds.indexOf(goalId);
  if (index < 0 || index >= positions.length) return null;
  return positions[index];
}
