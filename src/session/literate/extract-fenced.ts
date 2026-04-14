// MIT License — see LICENSE
//
// Fenced-block literate Agda code extraction (Markdown / Typst).
//
// Extracts code from ```agda … ``` blocks in .lagda.md and .lagda.typ
// files. Language-aware: tracks non-Agda fenced blocks so that
// ```agda text inside a ```haskell block is not mistakenly extracted.

import type { CodeBlock } from "./types.js";

export function extractFencedBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inAgdaBlock = false;
  let inOtherBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inAgdaBlock) {
      // Inside an Agda block — look for closing fence
      if (/^```+\s*$/.test(trimmed)) {
        if (codeLines.length > 0) {
          blocks.push({
            startLine,
            endLine: i, // line before closing ```
            code: codeLines.join("\n"),
          });
        }
        inAgdaBlock = false;
      } else {
        codeLines.push(lines[i]);
      }
    } else if (inOtherBlock) {
      // Inside a non-Agda fenced block — skip until closing fence
      if (/^```+\s*$/.test(trimmed)) {
        inOtherBlock = false;
      }
    } else {
      // Not inside any block — check for opening fences
      if (/^```+\s*agda\s*$/i.test(trimmed)) {
        // Agda code block
        inAgdaBlock = true;
        startLine = i + 2; // 1-indexed, next line after ```agda
        codeLines = [];
      } else if (/^```+/.test(trimmed)) {
        // Any other fenced block (bare ``` or ```haskell, etc.)
        // Skip the whole block so its contents don't accidentally
        // get matched as Agda code.
        inOtherBlock = true;
      }
    }
  }

  // Handle unclosed block — include accumulated code rather than silently discarding
  if (inAgdaBlock && codeLines.length > 0) {
    blocks.push({
      startLine,
      endLine: lines.length,
      code: codeLines.join("\n"),
    });
  }

  return blocks;
}
