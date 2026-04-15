// MIT License — see LICENSE
//
// Agda version–gated feature support.
//
// Centralizes knowledge of which Agda versions introduced (or removed)
// specific features so that the server can gate capabilities at runtime
// rather than failing opaquely when an unsupported feature is used.
//
// Static data tables (extension list, feature-flag list) live in JSON
// files under src/agda/data/ and are loaded + validated at module init.
// Logic (version comparison, capability derivation) stays in TypeScript.

import { z } from "zod";
import {
  atLeastMajorMinor,
  type AgdaVersion,
  parseAgdaVersion,
  versionAtLeast,
  formatVersion,
} from "./agda-version.js";
import { loadJsonData } from "../json-data.js";

// ── Literate format support ─────────────────────────────────────────

const agdaSourceExtensionSchema = z.object({
  suffix: z.string().min(1),
  minVersion: z.string().optional(),
});

type AgdaSourceExtensionEntry = { suffix: string; minVersion?: AgdaVersion };

/**
 * All recognised Agda source file extensions and the minimum Agda
 * version that introduced each one. `.agda` predates the version
 * numbers we track, so its `minVersion` is absent (always supported).
 *
 * Loaded from `src/agda/data/agda-source-extensions.json` so the
 * table is a JSON-backed SSOT decoupled from this logic module.
 */
const AGDA_SOURCE_EXTENSIONS: ReadonlyArray<AgdaSourceExtensionEntry> = loadJsonData(
  "./data/agda-source-extensions.json",
  z.array(agdaSourceExtensionSchema),
  import.meta.url,
).map((entry) => ({
  suffix: entry.suffix,
  minVersion: entry.minVersion ? parseAgdaVersion(entry.minVersion) : undefined,
}));

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
      if (agdaVersion && ext.minVersion && !versionAtLeast(agdaVersion, ext.minVersion)) {
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
    .filter((ext) => !agdaVersion || !ext.minVersion || versionAtLeast(agdaVersion, ext.minVersion))
    .map((ext) => ext.suffix);
}

/** All known Agda source extension suffixes, pre-computed once at module init. */
const ALL_SOURCE_EXTENSION_SUFFIXES: ReadonlyArray<string> = AGDA_SOURCE_EXTENSIONS.map((ext) => ext.suffix);

/** Returns all known Agda source extensions regardless of version. */
export function allSourceExtensionSuffixes(): string[] {
  return [...ALL_SOURCE_EXTENSION_SUFFIXES];
}

// ── Feature flags ───────────────────────────────────────────────────

const agdaFeatureFlagSchema = z.object({
  flag: z.string().min(1),
  minVersion: z.string().min(1),
});

/**
 * Agda feature flags and the version that introduced them.
 * Used to warn or skip when a feature is not available.
 *
 * Loaded from `src/agda/data/agda-feature-flags.json` so the
 * table is a JSON-backed SSOT decoupled from this logic module.
 */
const FEATURE_FLAGS: ReadonlyMap<string, AgdaVersion> = new Map(
  loadJsonData(
    "./data/agda-feature-flags.json",
    z.array(agdaFeatureFlagSchema),
    import.meta.url,
  ).map((entry) => [entry.flag, parseAgdaVersion(entry.minVersion)] as const),
);

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

/** All known feature flag names, pre-computed once at module init. */
const ALL_FEATURE_FLAG_NAMES: ReadonlyArray<string> = [...FEATURE_FLAGS.keys()];

/** Returns all known feature flag names regardless of version. */
export function allFeatureFlagNames(): string[] {
  return [...ALL_FEATURE_FLAG_NAMES];
}

// ── Protocol changes ────────────────────────────────────────────────
//
// These helpers answer "does this Agda's IOTCM parser accept the
// new shape?" — a parser-identity question. They intentionally use
// `atLeastMajorMinor` (not `versionAtLeast`) so a prerelease build
// like 2.9.0-rc1, which is produced from the same codebase as
// 2.9.0, reports the same shape as the stable release. Using
// `versionAtLeast` here would return false for rc1 (because
// prerelease sorts below stable), and the server would send the
// pre-2.9 bare form to an rc and eat a `cannot read:` error.

/** Agda 2.9.0 changed GiveResult from a raw string to {"paren": bool}. */
export function hasStructuredGiveResult(agdaVersion: AgdaVersion): boolean {
  return atLeastMajorMinor(agdaVersion, 2, 9);
}

/**
 * Agda 2.9.0 added a Rewrite mode argument to `Cmd_constraints`. On
 * 2.8.x and earlier the bare form `Cmd_constraints` is the only one
 * Agda accepts; on 2.9.x the bare form is rejected with `cannot read:`
 * and a mode argument (e.g. `Normalised`) is required. Verified
 * empirically against agda 2.8.0 (Homebrew) and agda 2.9.0
 * (`.cache/agda/2.9.0/bin/agda`). Prereleases of 2.9.0 report `true`
 * because the parser change lives in the 2.9 codebase.
 */
export function hasConstraintsRewriteMode(agdaVersion: AgdaVersion): boolean {
  return atLeastMajorMinor(agdaVersion, 2, 9);
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
