// MIT License — see LICENSE
//
// Pure helper for locating the Agda binary to spawn. Resolves in
// priority order: AGDA_BIN env var (explicit override), a repo-pinned
// tooling/scripts/run-pinned-agda.sh if one exists (per-repo pinning),
// then the plain "agda" on PATH as a fallback.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Find the repo-pinned Agda binary. */
export function findAgdaBinary(repoRoot: string): string {
  if (process.env.AGDA_BIN) {
    return process.env.AGDA_BIN;
  }
  const pinned = resolve(repoRoot, "tooling/scripts/run-pinned-agda.sh");
  if (existsSync(pinned)) {
    return pinned;
  }
  return "agda";
}
