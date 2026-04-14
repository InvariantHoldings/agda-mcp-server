// MIT License — see LICENSE
//
// Build the import dependency graph for an Agda project.
//
// `agda_impact` (§2.3 of docs/bug-reports/agent-ux-observations.md)
// asks: given a source file, which other files transitively import
// it? An agent that can answer that question gets to repair the
// most-impactful upstream file first, instead of grinding through
// downstream failures alphabetically.
//
// We build the answer purely from the filesystem — no Agda process,
// no .agdai cache — by:
//
//   1. Walking every recognised Agda source file under a project
//      root and parsing two things:
//        • the canonical module name from `module Foo.Bar where`
//        • every `import` / `open import` statement
//
//   2. Inverting the forward edge map (file → its imports) to a
//      reverse map (file → files that import it).
//
//   3. BFS-walking the reverse map to compute the transitive
//      dependents of any starting file.
//
// The parser is deliberately conservative: an Agda file can in
// principle place an `import` inside a `where` block, after a
// `private`, or behind preprocessor-style overhead, but in practice
// the survey-scale workloads §2.3 was written about put their
// imports in the standard top-of-file location. We strip block
// comments before scanning so a `{- ... import Foo ... -}` block
// can't fool the regex; line comments are stripped per-line.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { isAgdaSourceFile } from "./version-support.js";
import type { AgdaVersion } from "./agda-version.js";

/** A single Agda source file with its parsed module name. */
export interface AgdaModule {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Path relative to the project root the graph was built for. */
  relativePath: string;
  /** Canonical module name as declared by `module X.Y where`, or null on parse failure. */
  moduleName: string | null;
}

/**
 * The full import graph for a project. Both maps key on the
 * project-root-relative path of each module.
 */
export interface ImportGraph {
  /** Project-root-relative path → AgdaModule record. */
  modules: Map<string, AgdaModule>;
  /** Module name → relative path of the file declaring that module. */
  moduleNameToFile: Map<string, string>;
  /** Forward edges: rel-path → rel-paths of modules it imports. */
  imports: Map<string, string[]>;
  /** Reverse edges: rel-path → rel-paths of modules that import it. */
  importedBy: Map<string, string[]>;
}

/** Result of an impact query for one source file. */
export interface ImpactResult {
  /** The starting file, project-root-relative. */
  file: string;
  /** Module name declared by the starting file, or null. */
  moduleName: string | null;
  /** Modules that directly import the starting file (rel paths, sorted). */
  directDependents: string[];
  /**
   * Modules that transitively import the starting file (rel paths,
   * sorted). Includes everything in `directDependents` plus their
   * upstream consumers, etc. The starting file itself is excluded.
   */
  transitiveDependents: string[];
  /**
   * Modules the starting file directly imports (rel paths, sorted).
   * Cheap byproduct of the same parse; useful for "what does this
   * file actually depend on?" without a second tool call.
   */
  directDependencies: string[];
  /**
   * Modules the starting file transitively imports (rel paths,
   * sorted). Same byproduct; covers the upstream chain.
   */
  transitiveDependencies: string[];
}

// ── Parsing ────────────────────────────────────────────────────────

/**
 * Strip Agda's nesting block comments `{- ... -}` from a source
 * string. Agda's block comments nest, so we count depth instead of
 * matching pairs greedily. Line comments are left in place because
 * the per-line stripper handles them later.
 */
function stripBlockComments(source: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < source.length; i++) {
    if (depth === 0 && source[i] === "{" && source[i + 1] === "-") {
      depth = 1;
      i += 1;
      continue;
    }
    if (depth > 0 && source[i] === "{" && source[i + 1] === "-") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth > 0 && source[i] === "-" && source[i + 1] === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0) {
      out += source[i];
    }
  }
  return out;
}

/**
 * Strip a trailing `--` line comment from a single line. The
 * stripping is conservative: it doesn't try to detect `--` inside a
 * string literal because Agda's identifiers and operators don't
 * embed `--` for any purpose this scanner cares about.
 */
function stripLineComment(line: string): string {
  const idx = line.indexOf("--");
  return idx === -1 ? line : line.slice(0, idx);
}

/**
 * Match the canonical module name declared at the top of a file.
 * Examples: `module Foo where`, `module Foo.Bar.Baz where`,
 * `module Foo {ℓ} where`. Returns null if no module declaration is
 * found in the cleaned source.
 */
function parseModuleName(cleanedSource: string): string | null {
  // Anchor at line start; allow leading whitespace; allow optional
  // module parameters before `where`.
  const match = /^\s*module\s+([A-Za-z_][\w.]*)\b/m.exec(cleanedSource);
  return match ? match[1] : null;
}

/**
 * Parse every `import` / `open import` statement in the cleaned
 * source. Returns the imported module names in document order, with
 * duplicates preserved — the graph builder dedupes after resolving
 * the names to files.
 */
function parseImportedModuleNames(cleanedSource: string): string[] {
  const names: string[] = [];
  // ^[whitespace]?(open[whitespace])?import[whitespace]<modname>
  // We stop at the first non-identifier character so a trailing
  // `using`/`hiding`/`renaming`/`as`/`public` clause is ignored.
  const re = /^\s*(?:open\s+)?import\s+([A-Za-z_][\w.]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleanedSource)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Read and parse a single Agda source file. Returns `null` if the
 * file can't be opened (we don't want one unreadable file to crash
 * the whole graph build).
 */
function readAgdaModule(
  absolutePath: string,
  projectRoot: string,
): { mod: AgdaModule; importedNames: string[] } | null {
  let raw: string;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
  const cleaned = stripBlockComments(raw)
    .split(/\r?\n/u)
    .map(stripLineComment)
    .join("\n");
  const moduleName = parseModuleName(cleaned);
  const importedNames = parseImportedModuleNames(cleaned);
  return {
    mod: {
      absolutePath,
      relativePath: relative(projectRoot, absolutePath),
      moduleName,
    },
    importedNames,
  };
}

// ── Graph construction ─────────────────────────────────────────────

/**
 * Recursively walk `dir` and yield every absolute path that looks
 * like an Agda source file. Skips `_build/`, `node_modules/`,
 * `.git/`, and dotfile directories so a single bad import inside a
 * vendored copy of stdlib doesn't pollute the graph for the active
 * project.
 */
function* walkAgdaSources(dir: string, agdaVersion?: AgdaVersion): Generator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (
        entry.name === "_build"
        || entry.name === "node_modules"
        || entry.name === ".git"
        || entry.name.startsWith(".")
      ) {
        continue;
      }
      yield* walkAgdaSources(join(dir, entry.name), agdaVersion);
      continue;
    }
    if (entry.isFile() && isAgdaSourceFile(entry.name, agdaVersion)) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * Build the import graph for every Agda source under `projectRoot`.
 * `agdaVersion` is optional and only affects which literate
 * extensions count as Agda source files; pass it through from the
 * session if available.
 */
export function buildImportGraph(
  projectRoot: string,
  agdaVersion?: AgdaVersion,
): ImportGraph {
  const modules = new Map<string, AgdaModule>();
  const moduleNameToFile = new Map<string, string>();
  const importedNamesByFile = new Map<string, string[]>();

  for (const absPath of walkAgdaSources(projectRoot, agdaVersion)) {
    const parsed = readAgdaModule(absPath, projectRoot);
    if (!parsed) continue;
    modules.set(parsed.mod.relativePath, parsed.mod);
    importedNamesByFile.set(parsed.mod.relativePath, parsed.importedNames);
    if (parsed.mod.moduleName !== null && !moduleNameToFile.has(parsed.mod.moduleName)) {
      moduleNameToFile.set(parsed.mod.moduleName, parsed.mod.relativePath);
    }
  }

  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  for (const [relPath] of modules) {
    imports.set(relPath, []);
    importedBy.set(relPath, []);
  }

  for (const [relPath, importedNames] of importedNamesByFile) {
    const seen = new Set<string>();
    for (const name of importedNames) {
      const targetRel = moduleNameToFile.get(name);
      if (targetRel === undefined || seen.has(targetRel)) continue;
      seen.add(targetRel);
      imports.get(relPath)!.push(targetRel);
      importedBy.get(targetRel)!.push(relPath);
    }
  }

  // Sort so output is deterministic across platforms.
  for (const list of imports.values()) list.sort();
  for (const list of importedBy.values()) list.sort();

  return { modules, moduleNameToFile, imports, importedBy };
}

// ── Impact query ───────────────────────────────────────────────────

/**
 * Compute the impact set for a single file: who imports it
 * (transitively) and what does it import (transitively). The graph
 * is built from `projectRoot`; `sourceFile` may be absolute or
 * relative to `projectRoot`. Returns null when the file isn't part
 * of the graph (it doesn't exist, lives outside the project, or
 * has an unrecognised extension).
 */
export function computeImpact(
  graph: ImportGraph,
  projectRoot: string,
  sourceFile: string,
): ImpactResult | null {
  const absPath = isAbsolute(sourceFile) ? sourceFile : resolve(projectRoot, sourceFile);
  const relPath = relative(projectRoot, absPath);
  const mod = graph.modules.get(relPath);
  if (!mod) {
    return null;
  }

  const directDependents = (graph.importedBy.get(relPath) ?? []).slice();
  const transitiveDependents = collectReachable(graph.importedBy, relPath);
  const directDependencies = (graph.imports.get(relPath) ?? []).slice();
  const transitiveDependencies = collectReachable(graph.imports, relPath);

  return {
    file: relPath,
    moduleName: mod.moduleName,
    directDependents: directDependents.sort(),
    transitiveDependents: transitiveDependents.sort(),
    directDependencies: directDependencies.sort(),
    transitiveDependencies: transitiveDependencies.sort(),
  };
}

/**
 * Walk every node reachable from `start` along `edges`, excluding
 * `start` itself. BFS so the cost is linear in the number of nodes
 * and edges visited regardless of how deep the chain goes.
 */
function collectReachable(
  edges: Map<string, string[]>,
  start: string,
): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const next of edges.get(start) ?? []) {
    if (!seen.has(next) && next !== start) {
      seen.add(next);
      queue.push(next);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of edges.get(current) ?? []) {
      if (next === start || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen];
}

// Re-export `existsSync`/`statSync` indirectly via small helpers
// the tool layer can use without importing node:fs again.
export function fileExists(path: string): boolean {
  return existsSync(path);
}
export function fileMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
