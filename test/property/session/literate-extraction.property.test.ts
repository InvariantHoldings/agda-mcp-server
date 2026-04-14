// MIT License — see LICENSE
//
// Property-based tests for literate Agda code extraction.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  detectLiterateFormat,
  extractLiterateCode,
  type LiterateFormat,
} from "../../../src/session/literate-extraction.js";

// ── Generators ──────────────────────────────────────────────────────

const literateExtensions: Array<{ ext: string; format: LiterateFormat }> = [
  { ext: ".lagda", format: "latex" },
  { ext: ".lagda.tex", format: "latex" },
  { ext: ".lagda.md", format: "markdown" },
  { ext: ".lagda.typ", format: "typst" },
  { ext: ".lagda.rst", format: "rst" },
  { ext: ".lagda.org", format: "org" },
  { ext: ".lagda.tree", format: "tree" },
];

const arbLiterateExt = fc.constantFrom(...literateExtensions);

const arbCodeLine = fc.string({ minLength: 0, maxLength: 40 })
  .filter((s) =>
    !s.includes("\\end{code}") &&
    !s.includes("\\begin{code}") &&
    !s.includes("```") &&
    !s.includes("#+end_src") &&
    !s.includes("#+begin_src") &&
    !s.includes("\\agda{") &&
    !s.includes("{") &&
    !s.includes("}") &&
    !s.includes("::") &&
    !s.includes("\n"),
  );

const arbCodeBlock = fc.array(arbCodeLine, { minLength: 1, maxLength: 5 });

// For the "at least one block" property, we need non-empty content.
// RST blocks consisting only of empty/whitespace lines get trimmed away.
const arbNonEmptyCodeBlock = fc.array(
  arbCodeLine.filter((s) => s.trim().length > 0),
  { minLength: 1, maxLength: 5 },
);

function wrapInFormat(format: LiterateFormat, code: string): string {
  switch (format) {
    case "latex":
      return `\\documentclass{article}\n\\begin{document}\n\\begin{code}\n${code}\n\\end{code}\n\\end{document}`;
    case "markdown":
      return `# Title\n\n\`\`\`agda\n${code}\n\`\`\`\n`;
    case "typst":
      return `= Title\n\n\`\`\`agda\n${code}\n\`\`\`\n`;
    case "rst":
      return `::\n\n  ${code.split("\n").join("\n  ")}\n`;
    case "org":
      return `#+TITLE: Test\n\n#+begin_src agda2\n${code}\n#+end_src\n`;
    case "tree":
      return `\\title{Test}\n\\agda{\n${code}\n}\n`;
  }
}

// ── Property: format detection ──────────────────────────────────────

test("detectLiterateFormat returns correct format for all literate extensions", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, (extInfo) => {
      const filename = `Module${extInfo.ext}`;
      expect(detectLiterateFormat(filename)).toBe(extInfo.format);
    }),
  );
});

test("detectLiterateFormat returns null for .agda files", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 20 }), (name) => {
      const safeName = name.replace(/\./g, "_");
      expect(detectLiterateFormat(`${safeName}.agda`)).toBeNull();
    }),
  );
});

test("plain .agda files pass through unchanged", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (content) => {
      const result = extractLiterateCode("Module.agda", content);
      expect(result.format).toBeNull();
      expect(result.code).toBe(content);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].code).toBe(content);
    }),
  );
});

test("extracted code is a subset of the original content", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      for (const block of result.blocks) {
        for (const line of block.code.split("\n")) {
          expect(content).toContain(line);
        }
      }
    }),
  );
});

test("block line ranges are valid and 1-indexed", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      const totalLines = content.split("\n").length;
      for (const block of result.blocks) {
        expect(block.startLine).toBeGreaterThanOrEqual(1);
        expect(block.endLine).toBeGreaterThanOrEqual(block.startLine);
        expect(block.endLine).toBeLessThanOrEqual(totalLines);
      }
    }),
  );
});

test("blocks are ordered and non-overlapping", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      for (let i = 1; i < result.blocks.length; i++) {
        expect(result.blocks[i].startLine).toBeGreaterThan(
          result.blocks[i - 1].endLine,
        );
      }
    }),
  );
});

test("literate files with valid wrappers produce at least one block", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbNonEmptyCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.format).toBe(extInfo.format);
    }),
  );
});

test("result format always matches the detected format for the filename", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      expect(result.format).toBe(detectLiterateFormat(`Module${extInfo.ext}`));
    }),
  );
});

// ── Property: empty blocks are never emitted ────────────────────────

/** Build a literate file whose delimiters contain zero code lines. */
function wrapEmpty(format: LiterateFormat): string {
  switch (format) {
    case "latex":
      return "\\begin{code}\n\\end{code}";
    case "markdown":
      return "```agda\n```";
    case "typst":
      return "```agda\n```";
    case "org":
      return "#+begin_src agda2\n#+end_src";
    case "tree":
      return "\\agda{\n}";
    // RST is special: an empty indented block after :: is just the :: line
    // followed by a blank + non-indented content, which produces no block.
    case "rst":
      return "::\n\n  \n\nnot indented";
  }
}

test("empty delimited blocks produce zero extracted blocks", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, (extInfo) => {
      const content = wrapEmpty(extInfo.format);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      // Every emitted block must have non-empty code
      for (const block of result.blocks) {
        expect(block.code.trim().length).toBeGreaterThan(0);
      }
    }),
  );
});

/** Build a literate file whose delimiters contain only whitespace lines. */
function wrapWhitespaceOnly(format: LiterateFormat): string {
  switch (format) {
    case "latex":
      return "\\begin{code}\n   \n  \n\\end{code}";
    case "markdown":
      return "```agda\n  \n   \n```";
    case "typst":
      return "```agda\n  \n```";
    case "org":
      return "#+begin_src agda2\n  \n#+end_src";
    case "tree":
      return "\\agda{\n   \n}";
    case "rst":
      return "::\n\n     \n\nnot indented";
  }
}

test("whitespace-only delimited blocks produce zero extracted blocks", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, (extInfo) => {
      const content = wrapWhitespaceOnly(extInfo.format);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      // Every emitted block must have non-whitespace code
      for (const block of result.blocks) {
        expect(block.code.trim().length).toBeGreaterThan(0);
      }
    }),
  );
});

test("every extracted block has non-whitespace code", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      for (const block of result.blocks) {
        expect(block.code.trim().length).toBeGreaterThan(0);
      }
    }),
  );
});

test("no extracted block has endLine < startLine", async () => {
  await fc.assert(
    fc.property(arbLiterateExt, arbCodeBlock, (extInfo, codeLines) => {
      const code = codeLines.join("\n");
      const content = wrapInFormat(extInfo.format, code);
      const result = extractLiterateCode(`Module${extInfo.ext}`, content);
      for (const block of result.blocks) {
        expect(block.endLine).toBeGreaterThanOrEqual(block.startLine);
      }
    }),
  );
});

// ── Property: language-aware fenced blocks ──────────────────────────

const arbOtherLang = fc.constantFrom("haskell", "python", "javascript", "rust", "");

test("non-agda fenced blocks never appear in extracted code (markdown/typst)", async () => {
  // Use uniquely-tagged content so we can distinguish which block was extracted
  const AGDA_TAG = "AGDA_UNIQUE_MARKER_42";
  const OTHER_TAG = "OTHER_UNIQUE_MARKER_99";
  await fc.assert(
    fc.property(
      fc.constantFrom(
        { ext: ".lagda.md", format: "markdown" as const },
        { ext: ".lagda.typ", format: "typst" as const },
      ),
      arbOtherLang,
      (extInfo, otherLang) => {
        const otherBlock = otherLang
          ? `\`\`\`${otherLang}\n${OTHER_TAG}\n\`\`\``
          : `\`\`\`\n${OTHER_TAG}\n\`\`\``;
        const agdaBlock = `\`\`\`agda\n${AGDA_TAG}\n\`\`\``;
        const content = `${otherBlock}\n\n${agdaBlock}`;
        const result = extractLiterateCode(`M${extInfo.ext}`, content);
        // Only the agda block should be extracted
        expect(result.blocks).toHaveLength(1);
        expect(result.code).toContain(AGDA_TAG);
        expect(result.code).not.toContain(OTHER_TAG);
      },
    ),
  );
});
