// MIT License — see LICENSE
//
// Lightweight static parsers for Agda source files. These are NOT a
// full Agda parser — they cover the structural cases the agent-UX
// tools actually need (OPTIONS pragmas, `.agda-lib` flag lines,
// module/import shape, top-level definitions, postulate blocks).
// Pure regex/line-based; no I/O, no Agda subprocess.

import { splitWords } from "./refactor-helpers.js";

export interface ImportStatement {
  moduleName: string;
  line: number;
  openImport: boolean;
}

export interface ModuleSourceShape {
  moduleName: string | null;
  imports: ImportStatement[];
}

export interface DefinitionSite {
  name: string;
  line: number;
  typeSignature: boolean;
}

export interface PostulateSite {
  line: number;
  declarations: string[];
}

/** Extract every flag mentioned in any `{-# OPTIONS ... #-}` pragma. */
export function parseOptionsPragmas(source: string): string[] {
  const options: string[] = [];
  const re = /\{-#\s*OPTIONS\s+([^#]+)#-\}/gmu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    options.push(...splitWords(m[1]));
  }
  return options;
}

/** Extract `flags: ...` entries from a `.agda-lib` file body. */
export function parseAgdaLibFlags(source: string): string[] {
  const flags: string[] = [];
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!/^flags\s*:/u.test(line)) continue;
    const match = /^flags\s*:\s*(.*)$/u.exec(line);
    if (!match) continue;
    flags.push(...splitWords(match[1]));
  }
  return flags;
}

/**
 * Find the top-level `module Foo where` declaration and every
 * `import M` / `open import M` line. Returns a structural sketch of
 * the file useful for import-resolution and clash-source tools.
 */
export function parseModuleSourceShape(source: string): ModuleSourceShape {
  const moduleMatch = /^\s*module\s+([A-Za-z_][\w.]*)\b/mu.exec(source);
  const imports: ImportStatement[] = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(open\s+)?import\s+([A-Za-z_][\w.]*)\b/u.exec(lines[i]);
    if (!match) continue;
    imports.push({
      moduleName: match[2],
      line: i + 1,
      openImport: Boolean(match[1]),
    });
  }
  return {
    moduleName: moduleMatch?.[1] ?? null,
    imports,
  };
}

/**
 * Approximate top-level definition list: every line that starts at
 * column 0 with `name : ...` (signature) or `name ... = ...`
 * (equation) is a candidate. Captures the leading word as `name`
 * and the line number. Returns one entry per line that matches —
 * a function with both a signature and equations will appear
 * multiple times.
 */
export function parseTopLevelDefinitions(source: string): DefinitionSite[] {
  const defs: DefinitionSite[] = [];
  const lines = source.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sig = /^\s*([^\s].*?)\s*:\s*\S/u.exec(line);
    if (sig) {
      const name = sig[1].trim();
      if (name.length > 0) {
        defs.push({ name, line: i + 1, typeSignature: true });
      }
      continue;
    }
    const eq = /^\s*([^\s].*?)\s*=\s*\S/u.exec(line);
    if (eq) {
      const name = eq[1].trim().split(/\s+/u)[0];
      if (name.length > 0) {
        defs.push({ name, line: i + 1, typeSignature: false });
      }
    }
  }
  return defs;
}

/**
 * Find every `postulate` block in the source and list the names it
 * declares. Handles two forms:
 *
 *   - Inline: `postulate p q : Set` — names extracted from a single line.
 *   - Block:
 *     ```
 *     postulate
 *       p : Set
 *       q : Set
 *     ```
 *     Names from indented continuation lines until the indent drops
 *     back to the `postulate` level.
 *
 * Comment-only and blank lines inside a block are skipped.
 */
export function extractPostulateSites(source: string): PostulateSite[] {
  const lines = source.split(/\r?\n/u);
  const sites: PostulateSite[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!/^postulate\b/u.test(trimmed) && !/^\s+postulate\b/u.test(lines[i])) {
      continue;
    }

    const inline = /^postulate\s+(.+)$/u.exec(trimmed);
    if (inline) {
      // Split on `:` and tokenise LHS — handles `postulate p q : Set`
      const lhs = inline[1].split(":")[0].trim();
      const names = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      sites.push({ line: i + 1, declarations: names });
      continue;
    }

    const indent = lines[i].match(/^(\s*)/u)?.[1].length ?? 0;
    const declarations: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const body = lines[j];
      const bodyTrimmed = body.trim();
      // Skip blank and comment-only lines within the block
      if (bodyTrimmed.length === 0 || bodyTrimmed.startsWith("--")) {
        j += 1;
        continue;
      }
      const bodyIndent = body.match(/^(\s*)/u)?.[1].length ?? 0;
      if (bodyIndent <= indent) break;
      // Split on `:` and tokenise LHS — handles `p q : Set` (multiple names)
      const lhs = bodyTrimmed.split(":")[0].trim();
      const names = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      declarations.push(...names);
      j += 1;
    }
    sites.push({ line: i + 1, declarations });
  }

  return sites;
}
