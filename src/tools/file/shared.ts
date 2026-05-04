// MIT License — see LICENSE
//
// Shared helpers for the file-navigation tool family
// (`agda_read_module`, `agda_list_modules`, `agda_check_postulates`,
// `agda_search_definitions`). Path-resolution helpers live here so the
// individual tool modules under `src/tools/file/` stay focused on
// per-tool callback logic and don't each re-implement the sandboxed
// directory walk.

import { join, relative } from "node:path";

import {
  PathSandboxError,
  resolveExistingPathWithinRoot,
} from "../../repo-root.js";

/**
 * Default page size for `agda_list_modules`. Sized so a single response
 * comfortably fits inside an MCP client's per-tool token budget on a
 * many-hundred-module project — see §2.4 of the agent UX bug report.
 */
export const LIST_MODULES_DEFAULT_LIMIT = 25;
/** Hard cap so a caller can't ask for, say, 100k results in one shot. */
export const LIST_MODULES_MAX_LIMIT = 500;

/**
 * Build a display-friendly path relative to the project root, optionally
 * with a child-relative tail. Used by the directory walks in
 * `list-modules` / `search-definitions` so the rendered tree stays
 * relative to the tier root the caller asked about.
 */
export function relativeToRequestedRoot(
  repoRoot: string,
  requestedRoot: string,
  relativePath = "",
): string {
  const requestedBase = relative(repoRoot, requestedRoot);
  return relativePath ? join(requestedBase, relativePath) : requestedBase;
}

/**
 * Sandboxed variant of `resolveExistingPathWithinRoot` that returns
 * `null` instead of throwing when the candidate falls outside the root
 * — used inside directory walks where one hostile entry must not
 * abort the whole listing. Other errors (ENOENT, permission denied,
 * …) still propagate.
 */
export function resolveExistingChildWithinRoot(
  repoRoot: string,
  path: string,
): string | null {
  try {
    return resolveExistingPathWithinRoot(repoRoot, path);
  } catch (error) {
    if (error instanceof PathSandboxError) {
      return null;
    }
    throw error;
  }
}
