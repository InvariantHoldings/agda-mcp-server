// MIT License — see LICENSE
//
// Path utilities shared across tool modules. Pulled out to a single
// location so tools that need the same helper don't drift on whether
// to handle `realpathSync` failures by throwing or by returning the
// original input.

import { existsSync, realpathSync } from "node:fs";

import {
  PathSandboxError,
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../repo-root.js";

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

/**
 * Result of `resolveProjectFile` — either the canonical existing
 * filesystem path under the project root, or a structured error
 * carrying the classification + recovery hint the caller should
 * surface in its tool envelope. Discriminated by which field is set.
 */
export type ResolveProjectFileResult =
  | { filePath: string; error?: undefined }
  | {
      filePath?: undefined;
      error: {
        classification: "invalid-path" | "not-found";
        message: string;
        nextAction: string;
      };
    };

/**
 * Three-step path resolution shared across every file-input tool:
 *
 *   1. `resolveFileWithinRoot`        — sandbox escape on raw path → invalid-path
 *   2. `existsSync`                   — missing file → not-found
 *   3. `resolveExistingPathWithinRoot` — sandbox escape after symlink → invalid-path
 *
 * Returns a discriminated result so the caller can route each error to
 * its own per-tool envelope shape (with `emptyData(file)` etc.). On
 * success the returned `filePath` is the canonical existing path.
 */
export function resolveProjectFile(repoRoot: string, file: string): ResolveProjectFileResult {
  let requested: string;
  try {
    requested = resolveFileWithinRoot(repoRoot, file);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return {
        error: {
          classification: "invalid-path",
          message: `Invalid file path: ${file}`,
          nextAction:
            "The path resolved outside PROJECT_ROOT. Pass a relative path or an absolute path inside the project root.",
        },
      };
    }
    throw err;
  }
  if (!existsSync(requested)) {
    return {
      error: {
        classification: "not-found",
        message: `File not found: ${file}`,
        nextAction:
          "Confirm the path is relative to PROJECT_ROOT and the file exists. Use `agda_file_list` or `agda_search` to discover available files.",
      },
    };
  }
  try {
    return { filePath: resolveExistingPathWithinRoot(repoRoot, requested) };
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return {
        error: {
          classification: "invalid-path",
          message: `Invalid file path: ${file}`,
          nextAction:
            "The path canonicalised (after symlink resolution) outside PROJECT_ROOT. " +
            "Pass a path that doesn't symlink out of the project root.",
        },
      };
    }
    throw err;
  }
}
