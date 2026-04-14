// MIT License — see LICENSE
//
// Tree-sitter/forester literate Agda code extraction.
//
// Extracts code from \agda{…} blocks in .lagda.tree files.
// Handles both single-line and multi-line blocks with brace
// depth tracking.

import type { CodeBlock } from "./types.js";

export function extractTreeBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let inBlock = false;
  let startLine = 0;
  let codeLines: string[] = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock) {
      const agdaIdx = line.indexOf("\\agda{");
      if (agdaIdx !== -1) {
        inBlock = true;
        const afterOpen = line.slice(agdaIdx + 6);
        braceDepth = 1;

        // Count braces in the rest of the opening line
        for (const ch of afterOpen) {
          if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
          if (braceDepth === 0) break;
        }

        if (braceDepth === 0) {
          // Single-line \agda{...} — extract content between { and last }
          const content = afterOpen.slice(0, afterOpen.lastIndexOf("}"));
          if (content.trim()) {
            blocks.push({
              startLine: i + 1,
              endLine: i + 1,
              code: content,
            });
          }
          inBlock = false;
        } else {
          // Multi-line — content after \agda{ on opening line
          const firstLineContent = afterOpen.trim();
          if (firstLineContent) {
            startLine = i + 1;
            codeLines = [afterOpen];
          } else {
            startLine = i + 2;
            codeLines = [];
          }
        }
      }
    } else {
      // Inside a multi-line \agda{...} block
      let foundEnd = false;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === "{") braceDepth++;
        else if (line[j] === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            const lastCodePart = line.slice(0, j);
            if (lastCodePart.trim()) {
              codeLines.push(lastCodePart);
            }
            foundEnd = true;
            break;
          }
        }
      }

      if (foundEnd) {
        const code = codeLines.join("\n");
        if (code.trim()) {
          blocks.push({
            startLine,
            endLine: i + 1,
            code,
          });
        }
        inBlock = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  // Handle unclosed \agda{ block — include accumulated code
  if (inBlock && codeLines.length > 0) {
    blocks.push({
      startLine,
      endLine: lines.length,
      code: codeLines.join("\n"),
    });
  }

  return blocks;
}
