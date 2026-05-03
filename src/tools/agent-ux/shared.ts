// MIT License — see LICENSE
//
// Helpers shared across the agent-UX tool group. Pure functions only —
// no MCP / session state in here, so each helper can be unit-tested
// in isolation and reused by any sub-module under `tools/agent-ux/`.

import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { isAgdaSourceFile } from "../../agda/version-support.js";
import {
  parseModuleSourceShape,
  parseTopLevelDefinitions,
  rewriteCompilerPlaceholders,
} from "../../agda/agent-ux.js";

/**
 * All supported Agda source extensions including every literate variant.
 * Anchors a `.agda` / `.lagda[.md|.rst|.tex|.org|.typ|.tree]` suffix at
 * the END of the matched string.
 */
export const AGDA_SOURCE_SUFFIX_RE = /\.(?:agda|lagda(?:\.(?:md|rst|tex|org|typ|tree))?)$/iu;

/**
 * Captures an Agda-source-shaped path embedded inside a longer string
 * (e.g. an Agda diagnostic line "/abs/path/Foo.agda:12:3 ..."). Used to
 * extract the offender from compiler error text.
 */
export const AGDA_SOURCE_PATH_RE = /([A-Za-z0-9_./-]+\.(?:agda|lagda(?:\.(?:md|rst|tex|org|typ|tree))?))/iu;

/**
 * Recursively list every Agda source file under `root`, sorted by
 * absolute path. Skips `_build`, `.git`, and `node_modules` because
 * those are never Agda sources and walking them is expensive on large
 * checkouts.
 *
 * Returns `[]` for unreadable directories instead of throwing — this
 * keeps the bulk tools graceful in the face of a single permission
 * error rather than aborting the whole sweep.
 */
export function walkAgdaFiles(root: string, agdaVersion?: unknown): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_build" || entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        walk(abs);
        continue;
      }
      if (entry.isFile() && isAgdaSourceFile(entry.name, agdaVersion as Parameters<typeof isAgdaSourceFile>[1])) {
        files.push(abs);
      }
    }
  }

  walk(root);
  files.sort();
  return files;
}

/**
 * Build a minimal unified-diff-shaped string from before / after text.
 * Strictly line-based, no hunk reconciliation — just `-`/`+` pairs for
 * every line that differs. Suitable for displaying to a human; not for
 * patching.
 */
export function renderSimpleDiff(before: string, after: string, relPath: string): string {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  const max = Math.max(beforeLines.length, afterLines.length);
  const out: string[] = [];
  out.push(`--- ${relPath}`);
  out.push(`+++ ${relPath}`);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i] ?? "";
    const a = afterLines[i] ?? "";
    if (b === a) continue;
    out.push(`- ${b}`);
    out.push(`+ ${a}`);
  }
  return out.join("\n");
}

/**
 * `path.relative()` with a fallback to the input on cross-volume / weird
 * inputs that throw. Used for tool output where we want a relative path
 * if possible but never want to abort the response.
 */
export function relativeOrIdentity(root: string, path: string): string {
  try {
    return relative(root, path);
  } catch {
    return path;
  }
}

/** Escape a string for embedding inside a `RegExp` body. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pick the first Agda-source-shaped path out of a diagnostic message.
 * Returns null when the diagnostic has no path component (e.g. a plain
 * "Internal error" with no file context).
 */
export function extractPathFromDiagnostic(message: string): string | null {
  const rewritten = rewriteCompilerPlaceholders(message);
  const match = AGDA_SOURCE_PATH_RE.exec(rewritten);
  return match?.[1] ?? null;
}

/** Convert a relative on-disk path to its dotted Agda module name. */
export function moduleNameFromPath(relPath: string): string {
  return relPath
    .replace(AGDA_SOURCE_SUFFIX_RE, "")
    .replaceAll("\\", "/")
    .replace(/\//g, ".")
    .replace(/^agda\./, "");
}

/**
 * Map a load result to the bulk-sweep status bucket. `error` covers
 * both Agda type errors and any non-success classification; `holes`
 * covers nominally-successful loads that still have unfilled goals;
 * `clean` is the empty-state.
 */
export function classifyBulkStatus(
  result: { success: boolean; classification: string; hasHoles: boolean },
): "clean" | "holes" | "error" {
  if (!result.success || result.classification === "type-error") return "error";
  if (result.hasHoles || result.classification === "ok-with-holes") return "holes";
  return "clean";
}

/**
 * Insert `clause` immediately after the LAST line that begins with
 * `functionName` (i.e. after the last existing equation or signature
 * for that name). Falls back to end-of-file if the function name isn't
 * present anywhere — keeps the tool useful even when the caller's
 * context is slightly stale.
 */
export function insertClauseAtEndOfFunction(
  source: string,
  functionName: string,
  clause: string,
): string {
  const lines = source.split(/\r?\n/u);
  const fnRe = new RegExp(`^\\s*${escapeRegex(functionName)}\\b`, "u");
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fnRe.test(lines[i])) {
      lastIdx = i;
    }
  }
  const insertAt = lastIdx >= 0 ? lastIdx + 1 : lines.length;
  lines.splice(insertAt, 0, clause);
  return lines.join("\n");
}

/**
 * Walk every Agda file under `repoRoot/agda` and report any top-level
 * definitions whose name matches `symbol`. Returns the candidate's
 * dotted module name and the line where the definition starts.
 */
export function collectImportCandidates(
  repoRoot: string,
  symbol: string,
): Array<{ moduleName: string; file: string; line: number }> {
  const files = walkAgdaFiles(resolve(repoRoot, "agda"));
  const out: Array<{ moduleName: string; file: string; line: number }> = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const shape = parseModuleSourceShape(source);
    const moduleName = shape.moduleName ?? moduleNameFromPath(relative(repoRoot, file));
    for (const def of parseTopLevelDefinitions(source)) {
      if (def.name === symbol) {
        out.push({ moduleName, file: relative(repoRoot, file), line: def.line });
      }
    }
  }
  return out;
}

/**
 * Score an import candidate higher when:
 * - the candidate's module is already imported (exact match),
 * - the candidate shares its top-level namespace with an existing import,
 * - the candidate's dotted name is short (fewer dots).
 *
 * Used to rank `agda_suggest_import` results so the most-likely-correct
 * choice for the caller's existing import surface comes first.
 */
export function scoreImportCandidate(
  existingImports: Set<string>,
  moduleName: string,
): number {
  const head = moduleName.split(".")[0] ?? "";
  let score = 0;
  for (const existing of existingImports) {
    if (existing === moduleName) score += 100;
    if (existing.split(".")[0] === head) score += 5;
  }
  score -= moduleName.split(".").length;
  return score;
}

/**
 * Bucket label for grouping per-subdirectory project stats. Files that
 * sit directly under `baseDir` (no intermediate folder) all collapse
 * into the `"."` bucket so the output stays stable.
 */
export function computeSubdirectoryLabel(baseDir: string, relFile: string): string {
  const relToDir = relative(baseDir, relFile).replaceAll("\\", "/");
  const segments = relToDir.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return ".";
  return segments[0] ?? ".";
}
