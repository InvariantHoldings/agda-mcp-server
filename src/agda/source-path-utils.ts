// MIT License — see LICENSE
//
// Platform-aware Agda source path utilities. One module owns:
//
//   - The regex for "this looks like an Agda source path"
//     (`AGDA_SOURCE_PATH_RE`) and its end-anchored counterpart
//     (`AGDA_SOURCE_SUFFIX_RE`).
//   - Diagnostic-text path extraction (`extractPathFromDiagnostic`).
//   - Path → dotted-module-name mapping (`moduleNameFromPath`).
//   - Cross-platform separator normalization
//     (`toForwardSlashes`, `toPlatformSeparators`).
//
// Every Agda-source-path concern in the codebase routes through this
// module so the Windows-vs-POSIX path shape is handled in one place
// and tested once. Consumers in `src/tools/agent-ux/`,
// `src/session/`, etc. import from here rather than re-deriving the
// shape from the JSON extensions list.

import { sep as platformSep } from "node:path";

import { rewriteCompilerPlaceholders } from "./error-classifier.js";
import { allSourceExtensionSuffixes } from "./version-support.js";

/**
 * Build the alternation body for an Agda-source extension regex from
 * the JSON-backed list. Result is a non-capturing group of escaped
 * extensions, longest-first so `.lagda.md` wins over `.lagda` in
 * greedy matching. Centralised here so adding a literate variant to
 * `agda-source-extensions.json` automatically updates every consumer
 * regex.
 */
function extensionAlternation(): string {
  // Strip the leading `.` and group nested extensions so the alt is
  // `agda|lagda(?:\.(?:md|rst|...))?`. Sort longest-first so the
  // greedy regex engine prefers `lagda.md` over `lagda`.
  const stripped = allSourceExtensionSuffixes()
    .map((suffix) => suffix.startsWith(".") ? suffix.slice(1) : suffix)
    .sort((a, b) => b.length - a.length);

  const literateSuffixes = stripped
    .filter((s) => s.startsWith("lagda."))
    .map((s) => s.slice("lagda.".length));
  const hasLagda = stripped.includes("lagda");
  const hasAgda = stripped.includes("agda");

  const parts: string[] = [];
  if (hasAgda) parts.push("agda");
  if (hasLagda || literateSuffixes.length > 0) {
    if (literateSuffixes.length > 0) {
      parts.push(`lagda(?:\\.(?:${literateSuffixes.join("|")}))?`);
    } else {
      parts.push("lagda");
    }
  }
  return parts.join("|");
}

const EXT_ALTERNATION = extensionAlternation();

/**
 * Anchored at the END of the matched string. Used to strip an Agda
 * source extension off a path (`Foo.lagda.md` → `Foo`).
 */
export const AGDA_SOURCE_SUFFIX_RE = new RegExp(`\\.(?:${EXT_ALTERNATION})$`, "iu");

/**
 * Captures an Agda-source-shaped path embedded inside a longer
 * string. The token allows backslashes (Windows separators), forward
 * slashes (POSIX), colons (Windows drive letters), and unicode
 * identifiers; it stops at whitespace, parens, brackets, angle
 * brackets, or quotes — those are diagnostic separators around the
 * path. The match anchors to a recognised Agda extension suffix, so
 * the trailing `:LINE:COL` of an Agda diagnostic naturally falls
 * outside the capture.
 *
 * Use `extractPathFromDiagnostic` instead of this regex directly when
 * possible — it normalises away `rewriteCompilerPlaceholders`'s
 * uppercase placeholders first.
 */
// eslint-disable-next-line no-useless-escape
export const AGDA_SOURCE_PATH_RE = new RegExp(
  `([^\\s()\\[\\]<>"']+\\.(?:${EXT_ALTERNATION}))`,
  "iu",
);

/**
 * Pick the first Agda-source-shaped path out of a diagnostic message.
 * Returns null when the diagnostic has no path component (e.g. a plain
 * "Internal error" with no file context).
 */
export function extractPathFromDiagnostic(message: string): string | null {
  const rewritten = rewriteCompilerPlaceholders(message);
  const match = AGDA_SOURCE_PATH_RE.exec(rewritten);
  return match?.[1] ?? null;
}

/**
 * Convert a relative on-disk path to its dotted Agda module name.
 * Accepts both forward-slash and backslash separators (so the same
 * code works for paths a Windows agent passes in and POSIX tooling
 * produces).
 */
export function moduleNameFromPath(relPath: string): string {
  return relPath
    .replace(AGDA_SOURCE_SUFFIX_RE, "")
    .replaceAll("\\", "/")
    .replace(/\//g, ".")
    .replace(/^agda\./, "");
}

/**
 * Normalize any path separator (Windows backslash, POSIX forward
 * slash) to forward slash. Useful for keying maps and comparing paths
 * across the two platforms.
 */
export function toForwardSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Normalize separators to whichever the current platform uses.
 * `node:path.sep` is the canonical answer ("/" on POSIX, "\\" on
 * Windows). Used when feeding a path back to `path.join` /
 * `path.resolve` from a string source that came in mixed.
 */
export function toPlatformSeparators(path: string): string {
  if (platformSep === "/") return path.replaceAll("\\", "/");
  return path.replaceAll("/", "\\");
}
