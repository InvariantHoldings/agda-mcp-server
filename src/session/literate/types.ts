// MIT License — see LICENSE
//
// Shared types for literate Agda code extraction.

/** A single extracted code block with its source line range. */
export interface CodeBlock {
  /** 1-indexed start line in the original file. */
  startLine: number;
  /** 1-indexed end line (inclusive) in the original file. */
  endLine: number;
  /** The extracted code lines (no delimiter lines). */
  code: string;
}

export interface ExtractionResult {
  /** The detected literate format, or null if not a literate file. */
  format: LiterateFormat | null;
  /** Extracted code blocks. */
  blocks: CodeBlock[];
  /** All code concatenated with blank-line separators. */
  code: string;
}

export type LiterateFormat =
  | "latex"
  | "markdown"
  | "rst"
  | "org"
  | "tree"
  | "typst";
