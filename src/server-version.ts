// MIT License — see LICENSE
//
// Runtime package metadata access. Reads `version` and the
// `agdaMcpServer` block from this server's package.json so the
// declared supported-Agda range is the SSOT for both runtime checks
// (startup warning) and reporting tools (`agda_protocol_parity`,
// `agda_tools_catalog`).
//
// The package.json read happens ONCE at module init and is cached.
// Every accessor is then O(1). Before the cache, every `getServerVersion`
// call (which the tool-registration hot path invokes per request)
// did a synchronous filesystem read + JSON.parse — wasteful for a
// file that does not change between server start and exit.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  type AgdaVersion,
  compareVersions,
  formatVersion,
  parseAgdaVersion,
} from "./agda/agda-version.js";

const FALLBACK_VERSION = "0.0.0-dev";

// Bound strings must look like a dotted Agda version: 1+ numeric
// components, optional prerelease suffix. A typo in the package.json
// (e.g. "2.9-x" instead of "2.9.0-rc1") fails the schema parse at
// module init rather than silently degrading to "unknown" — which a
// maintainer might never notice because the in-range path still runs.
//
// Exported so unit tests can exercise both accepting and rejecting
// inputs without round-tripping through package.json on disk.
export const agdaVersionStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?$/u);

/**
 * Schema for the `agdaMcpServer` block alone. Kept separate from the
 * top-level `version` field so a typo in the range metadata cannot
 * blow away the version reading — see PR #52 review comment 4.
 */
export const agdaMcpServerBlockSchema = z.object({
  minAgdaVersion: agdaVersionStringSchema.optional(),
  maxTestedAgdaVersion: agdaVersionStringSchema.optional(),
});

/**
 * Schema for the whole `package.json` shape we care about. Used by
 * tests that want to assert the live file satisfies the contract.
 * The runtime loader does not use this directly — it parses `version`
 * and the `agdaMcpServer` block independently so a malformed range
 * field does not invalidate `version`.
 */
export const packageMetadataSchema = z.object({
  version: z.string().optional(),
  agdaMcpServer: agdaMcpServerBlockSchema.optional(),
});

interface PackageMetadata {
  version: string | undefined;
  agdaMcpServer: z.infer<typeof agdaMcpServerBlockSchema> | undefined;
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

/**
 * Pure parser for a parsed-JSON `package.json` value. Splits the two
 * concerns (`version` and `agdaMcpServer`) so one bad field cannot
 * invalidate the other — a typo in `agdaMcpServer.minAgdaVersion`
 * must not cause `getServerVersion()` to fall back to "0.0.0-dev"
 * (PR #52 review comment 4). Exported so unit tests can exercise
 * the split-parse contract without writing temp files.
 */
export function parsePackageMetadata(raw: unknown): PackageMetadata {
  const rawObject = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const version = typeof rawObject.version === "string" ? rawObject.version : undefined;
  const blockResult = agdaMcpServerBlockSchema.safeParse(rawObject.agdaMcpServer);
  const agdaMcpServer = blockResult.success ? blockResult.data : undefined;
  return { version, agdaMcpServer };
}

function readPackageJsonOnce(): PackageMetadata {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(here, "..", "package.json");
    return parsePackageMetadata(JSON.parse(readFileSync(packageJsonPath, "utf8")));
  } catch {
    // File missing or non-JSON — server still boots with empty metadata.
    return { version: undefined, agdaMcpServer: undefined };
  }
}

const PACKAGE_METADATA: PackageMetadata = readPackageJsonOnce();

const SERVER_VERSION: string = PACKAGE_METADATA.version ?? FALLBACK_VERSION;

const SUPPORTED_AGDA_RANGE: Readonly<SupportedAgdaRange> = Object.freeze({
  minAgdaVersion: PACKAGE_METADATA.agdaMcpServer?.minAgdaVersion,
  maxTestedAgdaVersion: PACKAGE_METADATA.agdaMcpServer?.maxTestedAgdaVersion,
});

/**
 * Pre-parse the declared bounds once. A malformed bound string is
 * silently treated as if absent (and the raw string is still surfaced
 * via `getSupportedAgdaRange` for the human-readable report). We
 * deliberately do NOT throw at module init: a bad bound would crash
 * the server before any reporting tool could explain why.
 */
const PARSED_MIN: AgdaVersion | undefined = (() => {
  if (!SUPPORTED_AGDA_RANGE.minAgdaVersion) return undefined;
  try { return parseAgdaVersion(SUPPORTED_AGDA_RANGE.minAgdaVersion); }
  catch { return undefined; }
})();

const PARSED_MAX: AgdaVersion | undefined = (() => {
  if (!SUPPORTED_AGDA_RANGE.maxTestedAgdaVersion) return undefined;
  try { return parseAgdaVersion(SUPPORTED_AGDA_RANGE.maxTestedAgdaVersion); }
  catch { return undefined; }
})();

export function getServerVersion(): string {
  return SERVER_VERSION;
}

/**
 * Returns the supported-Agda range declared in package.json's
 * `agdaMcpServer` block. Both fields fall through to `undefined` when
 * the block (or a particular field) is absent or non-string, so callers
 * can treat the range as opt-in metadata rather than a hard contract.
 */
export function getSupportedAgdaRange(): SupportedAgdaRange {
  return SUPPORTED_AGDA_RANGE;
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
  detected: AgdaVersion | null,
): AgdaVersionRangeStatus {
  const range = SUPPORTED_AGDA_RANGE;
  const detectedString = detected ? formatVersion(detected) : undefined;
  if (!detected) {
    return { classification: "unknown", detected: detectedString, range };
  }
  if (!PARSED_MIN && !PARSED_MAX) {
    return { classification: "unknown", detected: detectedString, range };
  }
  if (PARSED_MIN && compareVersions(detected, PARSED_MIN) < 0) {
    return { classification: "below-min", detected: detectedString, range };
  }
  if (PARSED_MAX && compareVersions(detected, PARSED_MAX) > 0) {
    return { classification: "above-max", detected: detectedString, range };
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
