// MIT License — see LICENSE
//
// Literate format detection from filename extension.

import type { LiterateFormat } from "./types.js";

/**
 * Detect the literate format from a filename.
 * Returns null for plain `.agda` files.
 */
export function detectLiterateFormat(filename: string): LiterateFormat | null {
  if (filename.endsWith(".lagda.md")) return "markdown";
  if (filename.endsWith(".lagda.typ")) return "typst";
  if (filename.endsWith(".lagda.rst")) return "rst";
  if (filename.endsWith(".lagda.org")) return "org";
  if (filename.endsWith(".lagda.tree")) return "tree";
  if (filename.endsWith(".lagda.tex")) return "latex";
  if (filename.endsWith(".lagda")) return "latex";
  return null;
}
