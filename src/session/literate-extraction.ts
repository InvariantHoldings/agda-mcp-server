// MIT License — see LICENSE
//
// Literate Agda code extraction — re-export shim.
//
// The actual extraction logic lives in src/session/literate/,
// split into per-format modules. This file re-exports everything
// so existing imports continue to work.

export {
  type CodeBlock,
  type ExtractionResult,
  type LiterateFormat,
  detectLiterateFormat,
  extractLiterateCode,
} from "./literate/index.js";
