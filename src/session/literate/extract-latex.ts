// MIT License — see LICENSE
//
// LaTeX literate Agda code extraction.
//
// Extracts code from \begin{code} … \end{code} blocks in
// .lagda and .lagda.tex files.

import type { CodeBlock } from "./types.js";

export function extractLatexBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inBlock && trimmed === "\\begin{code}") {
      inBlock = true;
      startLine = i + 2; // 1-indexed, next line after \begin{code}
      codeLines = [];
    } else if (inBlock && trimmed === "\\end{code}") {
      const code = codeLines.join("\n");
      if (code.trim()) {
        blocks.push({
          startLine,
          endLine: i, // line before \end{code}
          code,
        });
      }
      inBlock = false;
    } else if (inBlock) {
      codeLines.push(lines[i]);
    }
  }

  // Handle unclosed block — include accumulated code rather than silently discarding
  if (inBlock) {
    const code = codeLines.join("\n");
    if (code.trim()) {
      blocks.push({
        startLine,
        endLine: lines.length,
        code,
      });
    }
  }

  return blocks;
}
