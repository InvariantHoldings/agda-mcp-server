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

  let i = 0;
  let line = 0;
  let lineStart = 0;

  while (i < source.length) {
    // Skip line comments: any -- starts a comment to end of line
    if (source[i] === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    // Skip block comments: {- ... -} (nested)
    if (source[i] === "{" && source[i + 1] === "-") {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === "{" && source[i + 1] === "-") {
          depth++;
          i += 2;
        } else if (source[i] === "-" && source[i + 1] === "}") {
          depth--;
          i += 2;
        } else {
          if (source[i] === "\n") {
            line++;
            lineStart = i + 1;
          }
          i++;
        }
      }
      continue;
    }

    // Skip string literals
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i++; // skip escaped char
        if (source[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i < source.length) i++; // skip closing quote
      continue;
    }

    // Match {! ... !} interaction holes
    if (source[i] === "{" && source[i + 1] === "!") {
      const start = i;
      const col = i - lineStart;
      const startLine = line;
      i += 2; // skip {!

      // Find matching !}, skipping strings and comments inside hole contents
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{" && source[i + 1] === "!") {
          depth++;
          i += 2;
        } else if (source[i] === "!" && source[i + 1] === "}") {
          depth--;
          i += 2;
        } else if (source[i] === "-" && source[i + 1] === "-") {
          // Skip line comments inside hole contents
          while (i < source.length && source[i] !== "\n") i++;
        } else if (source[i] === "{" && source[i + 1] === "-") {
          // Skip block comments inside hole contents
          let commentDepth = 1;
          i += 2;
          while (i < source.length && commentDepth > 0) {
            if (source[i] === "{" && source[i + 1] === "-") {
              commentDepth++;
              i += 2;
            } else if (source[i] === "-" && source[i + 1] === "}") {
              commentDepth--;
              i += 2;
            } else {
              if (source[i] === "\n") { line++; lineStart = i + 1; }
              i++;
            }
          }
        } else if (source[i] === '"') {
          // Skip string literals inside hole contents
          i++;
          while (i < source.length && source[i] !== '"') {
            if (source[i] === "\\") i++;
            if (source[i] === "\n") { line++; lineStart = i + 1; }
            i++;
          }
          if (i < source.length) i++;
        } else {
          if (source[i] === "\n") {
            line++;
            lineStart = i + 1;
          }
          i++;
        }
      }

      positions.push({
        startOffset: start,
        endOffset: i,
        line: startLine,
        column: col,
        markerText: source.slice(start, i),
      });
      continue;
    }

    // Match ? question-mark holes
    if (source[i] === "?") {
      // ? is a hole only when it's a standalone token:
      // - preceded by whitespace, =, (, {, or start of file
      // - followed by whitespace, ), }, newline, end of file, or certain punctuation
      const prevChar = i > 0 ? source[i - 1] : " ";
      const nextChar = i + 1 < source.length ? source[i + 1] : " ";

      const prevOk = /[\s=({,;]/.test(prevChar) || i === 0;
      const nextOk = /[\s)}\n\r,;]/.test(nextChar) || i + 1 >= source.length;

      if (prevOk && nextOk) {
        positions.push({
          startOffset: i,
          endOffset: i + 1,
          line,
          column: i - lineStart,
          markerText: "?",
        });
        i++;
        continue;
      }
    }

    // Track line numbers
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }

    i++;
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
