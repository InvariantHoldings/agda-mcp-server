// MIT License — see LICENSE
//
// "Did you mean" suggestions for command-line flag typos.
//
// When a caller passes a flag like `Werror` (forgot the dashes) or
// `--werror` (wrong case), we want to offer a concrete correction
// rather than just "unknown flag". The whole catalogue of Agda flags
// is open-ended, so we suggest from `COMMON_AGDA_FLAGS` only — the
// well-known set most agents reach for. False negatives (no suggestion
// for an obscure flag) are fine; false positives (suggesting the wrong
// thing) are not, so the threshold is conservative.

import { COMMON_AGDA_FLAGS } from "./command-line-options.js";

/**
 * Maximum edit distance for a candidate to be offered as a suggestion.
 * 2 is enough to catch single-character typos, missing dashes (counts
 * as 2 inserts), and case-only differences (1 substitution per char).
 * Anything farther is more likely to be a real flag we don't list than
 * a typo of a flag we do list.
 */
const MAX_DISTANCE = 2;

/**
 * Levenshtein edit distance, with an early-exit optimisation: once the
 * minimum cost in a row exceeds `cap`, return `cap + 1`. Saves work on
 * obviously-different strings (the common case for unrelated flags).
 */
function editDistanceWithCap(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a === b) return 0;

  const aLen = a.length;
  const bLen = b.length;
  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

/**
 * Find the closest `COMMON_AGDA_FLAGS` entry to `input`, normalised to
 * always have a `--` prefix (so `Werror` and `-Werror` both match
 * `--Werror`). Case-insensitive comparison handles `--werror` →
 * `--Werror`.
 *
 * Returns the canonical flag string if a candidate within
 * `MAX_DISTANCE` is found, otherwise null. When multiple candidates
 * tie, the first in `COMMON_AGDA_FLAGS` (which is roughly
 * frequency-ordered) wins.
 */
export function suggestSimilarFlag(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Normalise: strip leading dashes so `--Werror` and `Werror` and
  // `-Werror` all hash to the same comparison key. We re-add the
  // canonical prefix from the matched COMMON_AGDA_FLAGS entry.
  const stripped = trimmed.replace(/^-+/u, "").toLowerCase();
  if (stripped.length === 0) return null;

  let best: { flag: string; distance: number } | null = null;
  for (const candidate of COMMON_AGDA_FLAGS) {
    const candidateKey = candidate.replace(/^-+/u, "").toLowerCase();
    const dist = editDistanceWithCap(stripped, candidateKey, MAX_DISTANCE);
    if (dist > MAX_DISTANCE) continue;
    if (best === null || dist < best.distance) {
      best = { flag: candidate, distance: dist };
      if (dist === 0) break;
    }
  }

  return best?.flag ?? null;
}
