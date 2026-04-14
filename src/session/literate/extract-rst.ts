// MIT License — see LICENSE
//
// reStructuredText literate Agda code extraction.
//
// Extracts code from indented blocks following :: directives in
// .lagda.rst files.

import type { CodeBlock } from "./types.js";

export function extractRstBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];
  let sawDirective = false;
  let blankAfterDirective = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inBlock && !sawDirective && trimmed === "::") {
      sawDirective = true;
      blankAfterDirective = false;
      continue;
    }

    if (sawDirective && !inBlock) {
      if (trimmed === "") {
        blankAfterDirective = true;
        continue;
      }
      if (blankAfterDirective && /^\s{2,}/.test(line)) {
        // First indented line after blank line after ::
        inBlock = true;
        startLine = i + 1; // 1-indexed
        codeLines = [line];
        continue;
      }
      // Non-indented, non-blank line after :: — not a code block
      sawDirective = false;
      blankAfterDirective = false;
    }

    if (inBlock) {
      // RST code blocks end at the first non-blank, non-indented line
      if (trimmed === "") {
        codeLines.push(line);
      } else if (/^\s{2,}/.test(line)) {
        codeLines.push(line);
      } else {
        // End of indented block — trim trailing blank lines
        while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") {
          codeLines.pop();
        }
        if (codeLines.length > 0) {
          blocks.push({
            startLine,
            endLine: startLine + codeLines.length - 1,
            code: codeLines.join("\n"),
          });
        }
        inBlock = false;
        codeLines = [];
        // Check if current line starts a new directive
        if (trimmed === "::") {
          sawDirective = true;
          blankAfterDirective = false;
        }
      }
    }
  }

  // Handle block at end of file
  if (inBlock && codeLines.length > 0) {
    // Trim trailing blank lines
    while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === "") {
      codeLines.pop();
    }
    if (codeLines.length > 0) {
      blocks.push({
        startLine,
        endLine: startLine + codeLines.length - 1,
        code: codeLines.join("\n"),
      });
    }
  }

  return blocks;
}
