// MIT License — see LICENSE
//
// Runtime package metadata access. Reads `version` and the
// `agdaMcpServer` block from this server's package.json so the
// declared supported-Agda range is the SSOT for both runtime checks
// (startup warning) and reporting tools (`agda_protocol_parity`,
// `agda_tools_catalog`).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AgdaVersion,
  compareVersions,
  formatVersion,
  parseAgdaVersion,
} from "./agda/agda-version.js";

const FALLBACK_VERSION = "0.0.0-dev";

interface PackageMetadata {
  version?: unknown;
  agdaMcpServer?: {
    minAgdaVersion?: unknown;
    maxTestedAgdaVersion?: unknown;
  };
}

/**
 * The declared range of Agda versions this server release was tested
 * against.  Both bounds are inclusive and use the same dotted form as
 * `agda --version` (e.g. "2.6.4.3", "2.9.0"). When the package.json
 * block is missing or malformed both fields are `undefined` and
 * range-aware code paths degrade to "unknown".
 */
export interface SupportedAgdaRange {
  /** Minimum Agda version this server release supports. */
  minAgdaVersion: string | undefined;
  /** Maximum Agda version this server release was tested against. */
  maxTestedAgdaVersion: string | undefined;
}

function readPackageJson(): PackageMetadata {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(here, "..", "package.json");
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageMetadata;
  } catch {
    return {};
  }
}

export function getServerVersion(): string {
  const pkg = readPackageJson();
  return typeof pkg.version === "string" ? pkg.version : FALLBACK_VERSION;
}

/**
 * Returns the supported-Agda range declared in package.json's
 * `agdaMcpServer` block. Both fields fall through to `undefined` when
 * the block (or a particular field) is absent or non-string, so callers
 * can treat the range as opt-in metadata rather than a hard contract.
 */
export function getSupportedAgdaRange(): SupportedAgdaRange {
  const pkg = readPackageJson();
  const block = pkg.agdaMcpServer ?? {};
  return {
    minAgdaVersion: typeof block.minAgdaVersion === "string" ? block.minAgdaVersion : undefined,
    maxTestedAgdaVersion: typeof block.maxTestedAgdaVersion === "string" ? block.maxTestedAgdaVersion : undefined,
  };
}

/**
 * Classification of a detected Agda version against the declared
 * supported range. Used by the startup warning and by reporting tools.
 *
 * - `unknown`     — no version detected, or no range declared.
 * - `below-min`   — detected version is older than `minAgdaVersion`.
 * - `in-range`    — detected version satisfies both bounds.
 * - `above-max`   — detected version is newer than `maxTestedAgdaVersion`.
 *                   This is a soft signal: the server should still run,
 *                   but the user is on an untested Agda.
 */
export type AgdaVersionRangeClassification =
  | "unknown"
  | "below-min"
  | "in-range"
  | "above-max";

export interface AgdaVersionRangeStatus {
  classification: AgdaVersionRangeClassification;
  /** Detected Agda version as a dotted string, or undefined if not detected. */
  detected: string | undefined;
  /** Declared range bounds (mirrors `getSupportedAgdaRange`). */
  range: SupportedAgdaRange;
}

/**
 * Classify a detected Agda version against the server's declared
 * supported range.  Returns `"unknown"` whenever either side is
 * missing — the range is opt-in metadata, not a hard contract, so an
 * absent block must not produce false positives.
 */
export function classifyAgdaAgainstSupportedRange(
  detected: AgdaVersion | null | undefined,
): AgdaVersionRangeStatus {
  const range = getSupportedAgdaRange();
  const detectedString = detected ? formatVersion(detected) : undefined;
  if (!detected) {
    return { classification: "unknown", detected: detectedString, range };
  }

  let belowMin = false;
  if (range.minAgdaVersion) {
    try {
      const min = parseAgdaVersion(range.minAgdaVersion);
      if (compareVersions(detected, min) < 0) belowMin = true;
    } catch {
      // Malformed bound — treat as if missing.
    }
  }
  if (belowMin) {
    return { classification: "below-min", detected: detectedString, range };
  }

  let aboveMax = false;
  if (range.maxTestedAgdaVersion) {
    try {
      const max = parseAgdaVersion(range.maxTestedAgdaVersion);
      if (compareVersions(detected, max) > 0) aboveMax = true;
    } catch {
      // Malformed bound — treat as if missing.
    }
  }
  if (aboveMax) {
    return { classification: "above-max", detected: detectedString, range };
  }

  if (!range.minAgdaVersion && !range.maxTestedAgdaVersion) {
    return { classification: "unknown", detected: detectedString, range };
  }
  return { classification: "in-range", detected: detectedString, range };
}

/**
 * Build a one-line human-readable warning describing how the detected
 * Agda version diverges from the declared range, or `undefined` when
 * the version is in-range or unclassifiable. Used by both the startup
 * warning printed to stderr and the `agda_protocol_parity` rendering.
 */
export function describeOutOfRangeWarning(
  status: AgdaVersionRangeStatus,
): string | undefined {
  if (status.classification === "below-min" && status.detected && status.range.minAgdaVersion) {
    return (
      `detected Agda ${status.detected} is below the declared minimum ` +
      `(${status.range.minAgdaVersion}); some tools may fail or report ` +
      `unexpected protocol-shape mismatches.`
    );
  }
  if (status.classification === "above-max" && status.detected && status.range.maxTestedAgdaVersion) {
    return (
      `detected Agda ${status.detected} is newer than the maximum tested ` +
      `version (${status.range.maxTestedAgdaVersion}); the server should still ` +
      `run, but new protocol shapes may not yet be supported.`
    );
  }
  return undefined;
}
