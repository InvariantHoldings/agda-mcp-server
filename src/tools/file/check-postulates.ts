// MIT License — see LICENSE
//
// `agda_check_postulates` — surface every `postulate` declaration in
// a file (inline or block form), with a Kernel-tier hard rule that
// flags any postulate as a violation. Pure source scan, no Agda
// session dependency — useful for CI gates and pre-commit hooks.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import { filePathDescription } from "../../agda/version-support.js";
import {
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../repo-root.js";
import { missingPathToolError, registerTextTool } from "../tool-helpers.js";

interface PostulateBlock {
  /** 1-based line number of the `postulate` keyword */
  line: number;
  /** Identifier names declared in the block (may be empty for inline postulate) */
  declarations: string[];
}

/**
 * Strip `-- …` line comments from a single line. Block comments
 * (`{- … -}`) are handled at the file level by
 * `stripAgdaBlockComments` before per-line scanning so a multi-line
 * block comment cannot leak a `postulate` token into the scanner.
 */
function stripLineComment(line: string): string {
  const lineCommentIndex = line.indexOf("--");
  if (lineCommentIndex === -1) return line;
  return line.slice(0, lineCommentIndex);
}

/**
 * Replace every `{- … -}` block comment in `source` with whitespace
 * of the same shape (newlines preserved, content blanked). Necessary
 * because Agda's block comments can span lines:
 *
 *     {-
 *     postulate fake : Set
 *     -}
 *
 * — without this pass, the per-line scanner below would see the
 * `postulate` keyword and report a false positive. Preserving the
 * line structure means reported line numbers continue to match the
 * original source.
 *
 * Agda block comments nest in principle (the lexer's `{-`/`-}`
 * matcher is a depth counter), so this implementation walks the
 * source character-by-character with a depth counter rather than
 * using a non-greedy regex (which would mis-handle `{- {- -} -}`).
 */
function stripAgdaBlockComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let depth = 0;
  while (i < source.length) {
    if (source[i] === "{" && source[i + 1] === "-") {
      depth += 1;
      out.push("  ");
      i += 2;
      continue;
    }
    if (depth > 0 && source[i] === "-" && source[i + 1] === "}") {
      depth -= 1;
      out.push("  ");
      i += 2;
      continue;
    }
    if (depth > 0) {
      // Replace comment content with whitespace; preserve newlines so
      // postulate-block line numbers still match the original.
      out.push(source[i] === "\n" ? "\n" : " ");
      i += 1;
      continue;
    }
    out.push(source[i]);
    i += 1;
  }
  return out.join("");
}

/**
 * Extract every postulate block (inline or indented body) from an
 * already-read source. Pure function so unit tests can drive it
 * directly without round-tripping through the filesystem.
 */
function findPostulates(fileContent: string): PostulateBlock[] {
  // Strip block comments file-wide first so a multi-line `{- … -}`
  // around a `postulate` keyword cannot register as a real declaration.
  const sourceForScan = stripAgdaBlockComments(fileContent);
  const lines = sourceForScan.split("\n");
  const blocks: PostulateBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!/^postulate\b/.test(trimmed) && !/^\s+postulate\b/.test(lines[i])) {
      continue;
    }

    // Inline form: `postulate ax : Set` or `postulate p q : Set` —
    // anything non-comment to the right of the keyword is the
    // declaration. Strip `-- …` line comments first so a header
    // like `postulate -- TODO` is treated as a block-style header
    // (no declarations on this line) rather than parsed as
    // `postulate <TODO>`.
    const stripped = stripLineComment(trimmed).trimEnd();
    const inlineMatch = /^postulate\s+(\S.*)$/.exec(stripped);
    if (inlineMatch) {
      const lhs = inlineMatch[1].split(":")[0].trim();
      const declNames = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      blocks.push({ line: i + 1, declarations: declNames });
      continue;
    }

    // Block form: collect indented body lines until de-indentation.
    const keywordIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
    const declarations: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const bodyLine = lines[j];
      const bodyTrimmed = bodyLine.trim();
      if (bodyTrimmed === "" || bodyTrimmed.startsWith("--")) {
        j++;
        continue;
      }
      const bodyIndent = bodyLine.match(/^(\s*)/)?.[1].length ?? 0;
      if (bodyIndent <= keywordIndent) {
        break;
      }
      const lhs = bodyTrimmed.split(":")[0].trim();
      const names = lhs.split(/\s+/u).filter((t) => t.length > 0 && !t.startsWith("--"));
      declarations.push(...names);
      j++;
    }
    blocks.push({ line: i + 1, declarations });
  }

  return blocks;
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_check_postulates",
    description: "Check an Agda file for postulate declarations. In Kernel/ files, postulates are forbidden by construction.",
    category: "navigation",
    // Pure source scan — no Agda subprocess. Discoverable in the
    // unloaded set so a CI gate or pre-commit hook can run it
    // without having to load the file first.
    requiresLoadedSession: false,
    inputSchema: { file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)) },
    outputDataSchema: z.object({
      text: z.string(),
      file: z.string(),
      blockCount: z.number(),
      declarationCount: z.number(),
      isKernel: z.boolean(),
      kernelViolation: z.boolean(),
      blocks: z.array(z.object({
        line: z.number(),
        declarations: z.array(z.string()),
      })),
    }),
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const fileContent = readFileSync(filePath, "utf-8");
      const blocks = findPostulates(fileContent);

      const canonicalRoot = resolveExistingPathWithinRoot(repoRoot, ".");
      const relPath = relative(canonicalRoot, filePath);
      const isKernel = relPath.startsWith("agda/Kernel/");
      let output = `## Postulate check: ${relPath}\n\n`;
      const totalDecls = blocks.reduce((sum, b) => sum + b.declarations.length, 0);
      if (blocks.length === 0) {
        output += "No postulates found. Fully constructive.\n";
      } else {
        const declSummary = totalDecls > 0
          ? ` (${totalDecls} identifier${totalDecls === 1 ? "" : "s"} declared)`
          : "";
        output += `**${blocks.length} postulate block${blocks.length === 1 ? "" : "s"} found${declSummary}**`;
        if (isKernel) output += ` **VIOLATION: postulates are forbidden in Kernel/**`;
        output += "\n\n";
        for (const block of blocks) {
          if (block.declarations.length > 0) {
            output += `- Line ${block.line}: postulate — ${block.declarations.join(", ")}\n`;
          } else {
            output += `- Line ${block.line}: postulate\n`;
          }
        }
      }
      return {
        text: output,
        data: {
          file: relPath,
          blockCount: blocks.length,
          declarationCount: totalDecls,
          isKernel,
          kernelViolation: isKernel && blocks.length > 0,
          blocks: blocks.map((b) => ({
            line: b.line,
            declarations: b.declarations,
          })),
        },
      };
    },
  });
}

// Exported for unit tests so the postulate scan can be exercised
// directly against synthetic source content without the filesystem
// round-trip.
export { findPostulates };
