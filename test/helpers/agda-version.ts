import { execSync } from "node:child_process";

/**
 * A parsed Agda version as a numeric tuple, e.g. [2, 7, 0, 1].
 * Shorter tuples are right-padded with zeros for comparison.
 */
export type AgdaVersion = number[];

/** Parse a version string like "2.7.0.1" or "Agda version 2.7.0.1" into a tuple. */
export function parseAgdaVersion(raw: string): AgdaVersion {
  const match = raw.match(/(\d+(?:\.\d+)*)/);
  if (!match) {
    throw new Error(`Cannot parse Agda version from: ${raw}`);
  }
  return match[1].split(".").map(Number);
}

/**
 * Compare two version tuples.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: AgdaVersion, b: AgdaVersion): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
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

/** Format a version tuple as a dotted string, e.g. "2.7.0.1". */
export function formatVersion(v: AgdaVersion): string {
  return v.join(".");
}
