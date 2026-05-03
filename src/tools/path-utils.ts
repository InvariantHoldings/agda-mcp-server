// MIT License — see LICENSE
//
// Path utilities shared across tool modules. Pulled out to a single
// location so tools that need the same helper don't drift on whether
// to handle `realpathSync` failures by throwing or by returning the
// original input.

import { realpathSync } from "node:fs";

/**
 * Resolve `path` to its canonical filesystem representation
 * (`realpathSync`), but return the original input on failure
 * instead of throwing. Used by `agda_cache_info` /
 * `agda_impact` to handle the macOS `/var → /private/var` symlink
 * (and equivalent platform-specific resolutions) without aborting
 * the tool when a path doesn't exist on disk yet.
 */
export function canonicalizeOrFallback(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
