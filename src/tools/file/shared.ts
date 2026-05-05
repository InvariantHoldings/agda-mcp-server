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
 * `null` instead of throwing for any error a tolerant directory walk
 * should treat as "skip this entry":
 *
 * - `PathSandboxError` — entry resolves outside the project root
 *   (e.g. a symlink pointing at `/etc`). Skipping is the
 *   security-preserving default; the entry never enters the listing.
 * - `ENOENT` — the entry was visible to `readdir` but disappeared by
 *   the time `realpath` ran (TOCTOU race) or is a broken symlink whose
 *   target no longer exists. Both cases are normal for a long walk
 *   over a live filesystem and must not crash the entire listing.
 * - `EACCES` / `EPERM` / `ELOOP` — permission denied or symlink-loop.
 *   Same tolerance applies; one bad entry must not abort the walk.
 *
 * **Caller responsibility for surfacing skipped entries.** Returning
 * `null` here only signals "skip this entry"; whether the skip is
 * reported to the agent depends on the caller. As of this writing:
 *
 * - `agda_search_definitions` records readdir-level failures in
 *   `unreadableSubtrees` and readFile-level failures in
 *   `unreadableFiles`, but a per-entry `null` from this helper is
 *   silently dropped (the file simply doesn't appear in matches).
 * - `agda_list_modules` records readdir-level failures in
 *   `unreadableSubtrees` and silently drops per-entry `null`s.
 *
 * If you add a new caller and want every skip surfaced, track the
 * `null` return at the call site and append the path to whatever
 * "unreadable" array the tool exposes. Don't move that logic in
 * here — different tools care about different granularities.
 *
 * Any other error (programmer bug, filesystem corruption) still
 * propagates — silent suppression of unknown failures would mask
 * real problems.
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
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ELOOP") {
      return null;
    }
    throw error;
  }
}
