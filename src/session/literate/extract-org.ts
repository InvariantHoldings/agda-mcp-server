// MIT License — see LICENSE
//
// Org-mode literate Agda code extraction.
//
// Extracts code from #+begin_src agda2 … #+end_src blocks in
// .lagda.org files. Delimiters are case-insensitive.

import type { CodeBlock } from "./types.js";

export function extractOrgBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    if (!inBlock && trimmed === "#+begin_src agda2") {
      inBlock = true;
      startLine = i + 2; // 1-indexed, next line after #+begin_src
      codeLines = [];
    } else if (inBlock && trimmed === "#+end_src") {
      const code = codeLines.join("\n");
      if (code.trim()) {
        blocks.push({
          startLine,
          endLine: i, // line before #+end_src
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
