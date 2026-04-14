// MIT License — see LICENSE
//
// Literate Agda code extraction — barrel module.
//
// Re-exports types, format detection, and the main extraction
// entry point. Per-format extractors live in their own modules.

export type { CodeBlock, ExtractionResult, LiterateFormat } from "./types.js";
export { detectLiterateFormat } from "./detect-format.js";
export { extractLatexBlocks } from "./extract-latex.js";
export { extractFencedBlocks } from "./extract-fenced.js";
export { extractRstBlocks } from "./extract-rst.js";
export { extractOrgBlocks } from "./extract-org.js";
export { extractTreeBlocks } from "./extract-tree.js";

import type { CodeBlock, ExtractionResult } from "./types.js";
import { detectLiterateFormat } from "./detect-format.js";
import { extractLatexBlocks } from "./extract-latex.js";
import { extractFencedBlocks } from "./extract-fenced.js";
import { extractRstBlocks } from "./extract-rst.js";
import { extractOrgBlocks } from "./extract-org.js";
import { extractTreeBlocks } from "./extract-tree.js";

/**
 * Extract code blocks from a literate Agda source file.
 * Returns the original content unchanged for plain `.agda` files.
 */
export function extractLiterateCode(
  filename: string,
  content: string,
): ExtractionResult {
  const format = detectLiterateFormat(filename);
  if (!format) {
    return {
      format: null,
      blocks: [{
        startLine: 1,
        endLine: content.split("\n").length,
        code: content,
      }],
      code: content,
    };
  }

  const lines = content.split("\n");
  let blocks: CodeBlock[];

  switch (format) {
    case "latex":
      blocks = extractLatexBlocks(lines);
      break;
    case "markdown":
    case "typst":
      blocks = extractFencedBlocks(lines);
      break;
    case "rst":
      blocks = extractRstBlocks(lines);
      break;
    case "org":
      blocks = extractOrgBlocks(lines);
      break;
    case "tree":
      blocks = extractTreeBlocks(lines);
      break;
  }

  const code = blocks.map((b) => b.code).join("\n\n");
  return { format, blocks, code };
}
