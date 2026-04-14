// MIT License — see LICENSE
//
// Locate and manipulate Agda's per-source `.agdai` build artifacts.
//
// Agda stores type-checked module interfaces in one of two places,
// determined per-source by `Agda.Interaction.FindFile.toIFile` in the
// upstream Agda sources:
//
//   1. **Separated interface** — when the source file lives inside a
//      project that has at least one `.agda-lib` file in some ancestor
//      directory, the interface goes under
//      `<projectRoot>/_build/<agdaVersion>/agda/<rel>.agdai`, where
//      `<rel>` is the source file's path relative to `<projectRoot>`
//      with the source extension swapped for `.agdai`.
//
//   2. **Local interface** — when no ancestor `.agda-lib` is found,
//      the interface lives next to the source as `<basename>.agdai`.
//
// Both can coexist (Agda warns `DuplicateInterfaceFiles` and picks
// one based on the `--local-interfaces` flag), so the cache-busting
// path needs to remove every artifact it can find rather than picking
// one. Layout verified empirically against agda 2.9.0
// (`.cache/agda/2.9.0/bin/agda`); see also Agda's
// `src/full/Agda/Interaction/FindFile.hs` `toIFile` for the formula.
//
// We deliberately scan from the source file each call instead of
// caching: the alternative is bookkeeping that gets out of sync the
// instant a user adds or removes an `.agda-lib` file mid-session,
// which is exactly the failure mode this whole feature is designed
// to backstop against.

import { existsSync, readdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The two layouts Agda's `toIFile` produces. See the module header. */
export type AgdaiArtifactKind = "separated" | "local";

/**
 * A single `.agdai` artifact discovered for a source file. Multiple
 * artifacts can exist for one source: one local-interface file plus
 * one separated-interface file per Agda version that previously built
 * the project.
 */
export interface AgdaiArtifact {
  /** Where this artifact lives in the layout. */
  kind: AgdaiArtifactKind;
  /** Absolute path to the .agdai file. */
  path: string;
  /**
   * The Agda version subdirectory the artifact lives under (e.g.
   * "2.9.0"). Always set for `kind === "separated"`; null for the
   * local-interface fallback because the local layout has no
   * version subdirectory.
   */
  agdaVersion: string | null;
  /** The artifact's last-modified time in ms-since-epoch. */
  mtimeMs: number;
  /**
   * Source mtime at the moment of discovery, in ms-since-epoch. May
   * be null if the source file has been deleted between discovery
   * and read — the cache info should still be reported in that case
   * so the caller knows the artifact is now orphaned.
   */
  sourceMtimeMs: number | null;
  /**
   * True when the cached interface is at least as fresh as the
   * source. False (stale) means the source has been modified after
   * the cache was last written. Null when source mtime can't be read.
   */
  fresh: boolean | null;
}

/**
 * Walk up from the source file's directory looking for the closest
 * ancestor that contains an `.agda-lib` file, and return that
 * directory. Mirrors `findProjectRoot` in
 * `Agda.Interaction.Library`. Returns `null` when no such ancestor
 * exists (Agda falls back to the local-interface layout in that case).
 *
 * **Sandbox boundary:** the walk is bounded at `repoRoot`. If the
 * closest `.agda-lib` lives *above* `repoRoot`, we refuse to return
 * it — the MCP server treats `repoRoot` as the blast-radius ceiling
 * for every file operation, so it would be wrong for `bustAgdaiCache`
 * to silently reach across that boundary and delete `.agdai` files
 * belonging to a parent project. Users who want Agda's true project
 * root outside the sandbox should launch the server with a wider
 * `PROJECT_ROOT`.
 */
export function findAgdaProjectRoot(
  sourceFile: string,
  repoRoot: string,
): string | null {
  // Canonicalize *both* sides before the containment check. The
  // caller may pass a realpathed source (e.g. `cache-tools.ts` routes
  // through `resolveExistingPathWithinRoot`) against a symlinked
  // repoRoot, which on macOS means `source` is `/private/var/...`
  // while `repoRoot` is `/var/...`. Without realpathing repoRoot
  // too, every walk step would look like it escaped the sandbox and
  // the function would refuse to return anything.
  const sourceAbs = canonicalizeOrFallback(
    isAbsolute(sourceFile) ? sourceFile : resolve(repoRoot, sourceFile),
  );
  const repoAbs = canonicalizeOrFallback(resolve(repoRoot));
  let current = dirname(sourceAbs);
  while (true) {
    if (!isWithinOrEqual(current, repoAbs)) {
      // Walked above the sandbox root. Whatever .agda-lib lives up
      // there is not our business even if Agda itself would pick it
      // up — the MCP sandbox takes precedence.
      return null;
    }
    if (directoryHasAgdaLib(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * `realpathSync` but fail-open: if the path can't be resolved (most
 * commonly because it doesn't exist yet), fall back to the input so
 * callers still get a reasonable answer. We never let a canonicaliser
 * failure turn a legitimate call into a thrown exception.
 */
function canonicalizeOrFallback(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True iff `child` is `parent` itself or lives beneath it. */
function isWithinOrEqual(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function directoryHasAgdaLib(dir: string): boolean {
  if (!existsSync(dir)) {
    return false;
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".agda-lib")) {
      return true;
    }
  }
  return false;
}

/**
 * Find every `.agdai` artifact for `sourceFile`. Returns:
 *
 *   - one separated artifact per Agda version subdirectory under
 *     `<projectRoot>/_build/`, if a project root was found
 *   - one local artifact (`<sourceDir>/<basename>.agdai`) if it
 *     exists, regardless of whether a project root was found
 *
 * Empty array when neither layout has produced an artifact yet (the
 * file has never been built).
 */
export function findAgdaiArtifacts(
  sourceFile: string,
  repoRoot: string,
): AgdaiArtifact[] {
  // Canonicalize the source before any path math so that the
  // relative() against a (separately canonicalized) project root
  // doesn't blow up with spurious `..` segments on macOS, where
  // `/var` is a symlink to `/private/var`. `findAgdaProjectRoot`
  // canonicalizes internally too — the redundant call here is
  // cheap and keeps the two path computations consistent.
  const sourceAbs = canonicalizeOrFallback(
    isAbsolute(sourceFile) ? sourceFile : resolve(repoRoot, sourceFile),
  );
  const sourceMtimeMs = readMtimeOrNull(sourceAbs);
  const artifacts: AgdaiArtifact[] = [];

  // ── 1. separated interfaces under <projectRoot>/_build ────────────
  const projectRoot = findAgdaProjectRoot(sourceAbs, repoRoot);
  if (projectRoot !== null) {
    const buildDir = join(projectRoot, "_build");
    if (existsSync(buildDir)) {
      const sourceRel = relative(projectRoot, sourceAbs);
      const agdaiRel = sourceRelToAgdaiRel(sourceRel);
      if (agdaiRel !== null && !sourceRel.startsWith("..") && !isAbsolute(sourceRel)) {
        for (const agdaVersion of listImmediateSubdirs(buildDir)) {
          const candidate = join(buildDir, agdaVersion, "agda", agdaiRel);
          const mtimeMs = readMtimeOrNull(candidate);
          if (mtimeMs === null) continue;
          artifacts.push({
            kind: "separated",
            path: candidate,
            agdaVersion,
            mtimeMs,
            sourceMtimeMs,
            fresh: sourceMtimeMs === null ? null : mtimeMs >= sourceMtimeMs,
          });
        }
      }
    }
  }

  // ── 2. local interface next to the source ────────────────────────
  const localPath = sourcePathToLocalAgdaiPath(sourceAbs);
  if (localPath !== null) {
    const mtimeMs = readMtimeOrNull(localPath);
    if (mtimeMs !== null) {
      artifacts.push({
        kind: "local",
        path: localPath,
        agdaVersion: null,
        mtimeMs,
        sourceMtimeMs,
        fresh: sourceMtimeMs === null ? null : mtimeMs >= sourceMtimeMs,
      });
    }
  }

  return artifacts;
}

/** Outcome of a single cache-bust attempt. */
export interface CacheBustFailure {
  path: string;
  reason: string;
}

/** Outcome of `bustAgdaiCache`. `removed` and `failed` are disjoint. */
export interface CacheBustResult {
  removed: string[];
  failed: CacheBustFailure[];
}

/**
 * Delete every `.agdai` artifact for `sourceFile` (separated and
 * local). Returns a structured result listing both successful
 * deletions and failures — failures are surfaced to the caller (see
 * `register-agda-load.ts`) via the tool response diagnostic so an
 * agent can tell the difference between "nothing to bust" and
 * "partial bust hit a permission error".
 *
 * Failures *do not* throw: the surrounding `agda_load` still has
 * value even when one artifact couldn't be removed (the subsequent
 * recompile will produce a fresh one where it can), and an
 * exception here would mask the load result the caller actually
 * asked for.
 */
export function bustAgdaiCache(
  sourceFile: string,
  repoRoot: string,
): CacheBustResult {
  const removed: string[] = [];
  const failed: CacheBustFailure[] = [];
  for (const artifact of findAgdaiArtifacts(sourceFile, repoRoot)) {
    try {
      unlinkSync(artifact.path);
      removed.push(artifact.path);
    } catch (err) {
      // A missing file is a no-op (another process beat us here),
      // not a failure worth reporting. Everything else — permission
      // denied, read-only filesystem, EBUSY on Windows — goes into
      // `failed` so the caller can render it.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") continue;
      failed.push({
        path: artifact.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { removed, failed };
}

/**
 * The set of Agda source extensions whose corresponding interface
 * file collapses the literate suffix down to `.agdai`. Matches
 * Agda's `dropAgdaExtension` behaviour in
 * `src/full/Agda/Interaction/FindFile.hs`.
 */
const AGDA_SOURCE_SUFFIXES = [
  ".agda",
  ".lagda",
  ".lagda.tex",
  ".lagda.md",
  ".lagda.rst",
  ".lagda.org",
  ".lagda.tree",
  ".lagda.typ",
] as const;

/**
 * Sort longest-first so that `.lagda.md` wins over `.lagda` when
 * stripping the suffix from a file like `Foo.lagda.md`.
 */
const AGDA_SOURCE_SUFFIXES_LONGEST_FIRST = [...AGDA_SOURCE_SUFFIXES].sort(
  (a, b) => b.length - a.length,
);

function sourceRelToAgdaiRel(sourceRel: string): string | null {
  for (const suffix of AGDA_SOURCE_SUFFIXES_LONGEST_FIRST) {
    if (sourceRel.endsWith(suffix)) {
      return `${sourceRel.slice(0, -suffix.length)}.agdai`;
    }
  }
  return null;
}

function sourcePathToLocalAgdaiPath(sourceAbs: string): string | null {
  for (const suffix of AGDA_SOURCE_SUFFIXES_LONGEST_FIRST) {
    if (sourceAbs.endsWith(suffix)) {
      return `${sourceAbs.slice(0, -suffix.length)}.agdai`;
    }
  }
  return null;
}

function listImmediateSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readMtimeOrNull(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// Re-export `sep` so tests can construct platform-correct path
// fixtures without importing node:path themselves.
export const PATH_SEP = sep;
