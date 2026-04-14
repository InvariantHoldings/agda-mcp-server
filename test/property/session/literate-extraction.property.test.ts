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
