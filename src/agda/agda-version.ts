// MIT License — see LICENSE
//
// Agda version detection, parsing, and comparison.
//
// Used at runtime to gate features that require specific Agda versions
// and in tests to skip fixtures that need a newer Agda.

import { execSync } from "node:child_process";

/**
 * A parsed Agda version with numeric tuple and optional prerelease flag.
 * Prerelease versions (e.g. 2.9.0-rc1) compare as strictly less than
 * the corresponding stable release (2.9.0).
 */
export interface AgdaVersion {
  parts: number[];
  prerelease: boolean;
}

/**
 * Parse a version string like "2.7.0.1" or "Agda version 2.9.0-rc1"
 * into a structured version. Prerelease suffixes (-rc1, -beta2, -alpha)
 * are detected and stored so that 2.9.0-rc1 < 2.9.0.
 */
export function parseAgdaVersion(raw: string): AgdaVersion {
  const match = raw.match(/(\d+(?:\.\d+)*)(-[A-Za-z0-9.]+)?/);
  if (!match) {
    throw new Error(`Cannot parse Agda version from: ${raw}`);
  }
  return {
    parts: match[1].split(".").map(Number),
    prerelease: match[2] !== undefined,
  };
}

/**
 * Compare two versions.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Prerelease versions sort below their stable counterpart:
 * 2.9.0-rc1 < 2.9.0, but 2.9.0-rc1 > 2.8.999.
 */
export function compareVersions(a: AgdaVersion, b: AgdaVersion): number {
  const len = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Numeric parts are equal — prerelease loses to stable.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return 0;
}

/** Returns true if `version` satisfies `>= minVersion`. */
export function versionAtLeast(
  version: AgdaVersion,
  minVersion: AgdaVersion,
): boolean {
  return compareVersions(version, minVersion) >= 0;
}

/**
 * Detect the installed Agda version by running `agda --version`.
 * Returns undefined if Agda is not available.
 */
export function detectAgdaVersion(): AgdaVersion | undefined {
  try {
    const output = execSync("agda --version", { stdio: "pipe" }).toString();
    return parseAgdaVersion(output);
  } catch {
    return undefined;
  }
}

/** Format a version as a dotted string, e.g. "2.7.0.1" or "2.9.0-pre". */
export function formatVersion(v: AgdaVersion): string {
  return v.parts.join(".") + (v.prerelease ? "-pre" : "");
}
