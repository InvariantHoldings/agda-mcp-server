// MIT License — see LICENSE
//
// Pure refactor / search helpers used by multiple agent-UX layers.
// Token splitting, type-pattern matching, scoped renames, and the
// auto-search payload builder all live here. No I/O — everything
// operates on already-loaded source strings or option objects.

export interface AutoSearchOptions {
  depth?: number;
  listCandidates?: boolean;
  excludeHints?: string[];
  hints?: string[];
}

export interface ScopedRenameResult {
  updated: string;
  replacements: number;
}

/** Split a string on whitespace, trim, and drop empty tokens. */
export function splitWords(input: string): string[] {
  return input
    .trim()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Single-token match with `_` as a wildcard. */
function tokenMatches(pattern: string, actual: string): boolean {
  if (pattern === "_") return true;
  return pattern === actual;
}

/**
 * Lightweight type-shape match: walk `pattern` tokens left-to-right
 * and confirm each one appears in order in `typeText`, with `_`
 * matching any single token. Greedy on the actual side, so
 * `pattern = "Nat → _"` matches `"Nat → List Nat"`. Returns true iff
 * every pattern token was consumed.
 */
export function matchesTypePattern(typeText: string, pattern: string): boolean {
  const actualTokens = splitWords(typeText);
  const patternTokens = splitWords(pattern);
  if (patternTokens.length === 0) return false;
  if (actualTokens.length === 0) return false;

  let p = 0;
  let a = 0;
  while (p < patternTokens.length && a < actualTokens.length) {
    const want = patternTokens[p];
    if (want === "_") {
      p += 1;
      a += 1;
      continue;
    }
    if (tokenMatches(want, actualTokens[a])) {
      p += 1;
      a += 1;
      continue;
    }
    a += 1;
  }
  return p === patternTokens.length;
}

/** True if `text` looks like a single Agda identifier (letters, digits, `_`, `'`, `.`). */
function isIdentifierLike(text: string): boolean {
  return /^[\p{L}\p{N}_'.]+$/u.test(text);
}

/**
 * Replace `from` with `to` in `source`, treating identifiers as
 * word-bounded so `Nat` doesn't replace inside `Natural`. For
 * non-identifier `from` strings (e.g. `_,_`), falls back to plain
 * substring replacement. Returns the updated source plus a count
 * of replacements made.
 */
export function applyScopedRename(source: string, from: string, to: string): ScopedRenameResult {
  if (from.length === 0 || from === to) {
    return { updated: source, replacements: 0 };
  }

  if (isIdentifierLike(from)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_'])(${escaped})(?=$|[^\\p{L}\\p{N}_'])`, "gmu");
    let replacements = 0;
    const updated = source.replace(re, (match, prefix: string, name: string) => {
      void match;
      void name;
      replacements += 1;
      return `${prefix}${to}`;
    });
    return { updated, replacements };
  }

  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gu");
  let replacements = 0;
  const updated = source.replace(re, () => {
    replacements += 1;
    return to;
  });
  return { updated, replacements };
}

/**
 * Build the payload string for `Cmd_auto`. Composes depth, candidate
 * listing, hints, and excludes into the space-separated argv form
 * Agda's auto-search expects.
 */
export function buildAutoSearchPayload(options: AutoSearchOptions): string {
  const flags: string[] = [];
  if (options.depth !== undefined) {
    flags.push(`-d ${Math.max(0, Math.trunc(options.depth))}`);
  }
  if (options.listCandidates) {
    flags.push("--list-candidates");
  }
  for (const hint of options.hints ?? []) {
    if (hint.trim().length > 0) {
      flags.push(`-h ${hint.trim()}`);
    }
  }
  for (const excluded of options.excludeHints ?? []) {
    if (excluded.trim().length > 0) {
      flags.push(`-x ${excluded.trim()}`);
    }
  }
  return flags.join(" ").trim();
}
