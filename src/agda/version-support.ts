// MIT License — see LICENSE
//
// Agda version–gated feature support.
//
// Centralizes knowledge of which Agda versions introduced (or removed)
// specific features so that the server can gate capabilities at runtime
// rather than failing opaquely when an unsupported feature is used.

import {
  type AgdaVersion,
  parseAgdaVersion,
  versionAtLeast,
  formatVersion,
} from "./agda-version.js";

// ── Literate format support ─────────────────────────────────────────

/** All recognised Agda source file extensions and their minimum Agda version. */
const AGDA_SOURCE_EXTENSIONS: ReadonlyArray<{ suffix: string; minVersion: AgdaVersion }> = [
  { suffix: ".agda",        minVersion: parseAgdaVersion("0.0") },
  { suffix: ".lagda",       minVersion: parseAgdaVersion("2.5.1") },
  { suffix: ".lagda.tex",   minVersion: parseAgdaVersion("2.5.3") },
  { suffix: ".lagda.md",    minVersion: parseAgdaVersion("2.5.3") },
  { suffix: ".lagda.rst",   minVersion: parseAgdaVersion("2.5.3") },
  { suffix: ".lagda.org",   minVersion: parseAgdaVersion("2.6.1") },
  { suffix: ".lagda.tree",  minVersion: parseAgdaVersion("2.7.0") },
  { suffix: ".lagda.typ",   minVersion: parseAgdaVersion("2.7.0") },
];

/**
 * Returns true if the filename has a recognised Agda source extension.
 * When `agdaVersion` is provided, also checks that the installed Agda
 * supports that particular literate format.
 */
export function isAgdaSourceFile(
  filename: string,
  agdaVersion?: AgdaVersion,
): boolean {
  for (const ext of AGDA_SOURCE_EXTENSIONS) {
    if (filename.endsWith(ext.suffix)) {
      if (agdaVersion && !versionAtLeast(agdaVersion, ext.minVersion)) {
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Returns the list of Agda source extensions supported by the given
 * Agda version. If no version is provided, returns all known extensions.
 */
export function supportedSourceExtensions(agdaVersion?: AgdaVersion): string[] {
  return AGDA_SOURCE_EXTENSIONS
    .filter((ext) => !agdaVersion || versionAtLeast(agdaVersion, ext.minVersion))
    .map((ext) => ext.suffix);
}

// ── Feature flags ───────────────────────────────────────────────────

/**
 * Agda feature flags and the version that introduced them.
 * Used to warn or skip when a feature is not available.
 */
const FEATURE_FLAGS: ReadonlyMap<string, AgdaVersion> = new Map([
  ["--cubical",       parseAgdaVersion("2.6.0")],
  ["--cumulativity",  parseAgdaVersion("2.6.0")],
  ["--sized-types",   parseAgdaVersion("2.2.0")],
  ["--rewriting",     parseAgdaVersion("2.4.2.4")],
  ["--with-K",        parseAgdaVersion("2.4.2.4")],
  ["--guarded",       parseAgdaVersion("2.6.2")],
  ["--erasure",       parseAgdaVersion("2.6.4")],
  ["--two-level",     parseAgdaVersion("2.6.2")],
]);

/** Returns true if the given feature flag is supported by this Agda version. */
export function supportsFeatureFlag(
  flag: string,
  agdaVersion: AgdaVersion,
): boolean {
  const minVersion = FEATURE_FLAGS.get(flag);
  if (!minVersion) {
    // Unknown flag — let Agda decide
    return true;
  }
  return versionAtLeast(agdaVersion, minVersion);
}

/**
 * Returns all recognised feature flags supported by the given Agda version.
 */
export function supportedFeatureFlags(agdaVersion: AgdaVersion): string[] {
  return [...FEATURE_FLAGS.entries()]
    .filter(([, minVersion]) => versionAtLeast(agdaVersion, minVersion))
    .map(([flag]) => flag);
}

// ── Protocol changes ────────────────────────────────────────────────

/** Agda 2.9.0 changed GiveResult from a raw string to {"paren": bool}. */
export function hasStructuredGiveResult(agdaVersion: AgdaVersion): boolean {
  return versionAtLeast(agdaVersion, parseAgdaVersion("2.9.0"));
}

// ── Tool description helpers ────────────────────────────────────────

/**
 * Returns a human-readable file path description for tool schemas,
 * reflecting which literate formats are actually supported.
 */
export function filePathDescription(agdaVersion?: AgdaVersion): string {
  const exts = supportedSourceExtensions(agdaVersion);
  if (exts.length <= 1) {
    return "Path to the .agda file (relative to repo root or absolute)";
  }
  return `Path to an Agda source file (${exts.join(", ")}) — relative to repo root or absolute`;
}

// ── Capability summary ──────────────────────────────────────────────

/**
 * A flat record of version-gated capabilities computed from a detected
 * Agda version.  All fields are undefined when no version is known.
 */
export interface AgdaCapabilities {
  /** Formatted version string, e.g. "2.9.0". */
  agdaVersion: string | undefined;
  /** Source file extensions supported by this version. */
  supportedExtensions: string[] | undefined;
  /** Feature flags supported by this version. */
  supportedFeatureFlags: string[] | undefined;
  /** Whether Agda returns structured {"paren": bool} give results (2.9.0+). */
  structuredGiveResult: boolean | undefined;
}

/**
 * Compute all version-gated capabilities from a detected Agda version.
 * Returns all-undefined when `agdaVer` is null (version not yet detected).
 *
 * Use this instead of computing each field independently to avoid duplication.
 */
export function getAgdaCapabilities(agdaVer: AgdaVersion | null): AgdaCapabilities {
  if (!agdaVer) {
    return {
      agdaVersion: undefined,
      supportedExtensions: undefined,
      supportedFeatureFlags: undefined,
      structuredGiveResult: undefined,
    };
  }
  return {
    agdaVersion: formatVersion(agdaVer),
    supportedExtensions: supportedSourceExtensions(agdaVer),
    supportedFeatureFlags: supportedFeatureFlags(agdaVer),
    structuredGiveResult: hasStructuredGiveResult(agdaVer),
  };
}
