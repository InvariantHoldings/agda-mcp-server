// MIT License — see LICENSE
//
// Unit tests for literate Agda code extraction against real fixtures.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  detectLiterateFormat,
  extractLiterateCode,
} from "../../../src/session/literate-extraction.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

describe("detectLiterateFormat", () => {
  it("returns null for plain .agda files", () => {
    expect(detectLiterateFormat("Foo.agda")).toBeNull();
  });

  it("detects .lagda as latex", () => {
    expect(detectLiterateFormat("Foo.lagda")).toBe("latex");
  });

  it("detects .lagda.tex as latex", () => {
    expect(detectLiterateFormat("Foo.lagda.tex")).toBe("latex");
  });

  it("detects .lagda.md as markdown", () => {
    expect(detectLiterateFormat("Foo.lagda.md")).toBe("markdown");
  });

  it("detects .lagda.rst as rst", () => {
    expect(detectLiterateFormat("Foo.lagda.rst")).toBe("rst");
  });

  it("detects .lagda.org as org", () => {
    expect(detectLiterateFormat("Foo.lagda.org")).toBe("org");
  });

  it("detects .lagda.tree as tree", () => {
    expect(detectLiterateFormat("Foo.lagda.tree")).toBe("tree");
  });

  it("detects .lagda.typ as typst", () => {
    expect(detectLiterateFormat("Foo.lagda.typ")).toBe("typst");
  });

  it("returns null for non-agda extensions", () => {
    expect(detectLiterateFormat("Foo.hs")).toBeNull();
    expect(detectLiterateFormat("Foo.py")).toBeNull();
    expect(detectLiterateFormat("Foo.txt")).toBeNull();
  });
});

describe("extractLiterateCode from real fixtures", () => {
  it("extracts from LiterateLatex.lagda", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateLatex.lagda"), "utf-8");
    const result = extractLiterateCode("LiterateLatex.lagda", content);

    expect(result.format).toBe("latex");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateLatex where");
    expect(result.code).toContain("data Nat : Set where");
    expect(result.code).toContain("test = {!!}");
    // Should not contain LaTeX wrapper
    expect(result.code).not.toContain("\\documentclass");
    expect(result.code).not.toContain("\\begin{code}");
    expect(result.code).not.toContain("\\end{code}");
  });

  it("extracts from LiterateTexExplicit.lagda.tex", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateTexExplicit.lagda.tex"), "utf-8");
    const result = extractLiterateCode("LiterateTexExplicit.lagda.tex", content);

    expect(result.format).toBe("latex");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateTexExplicit where");
    expect(result.code).not.toContain("\\begin{code}");
  });

  it("extracts from LiterateMarkdown.lagda.md", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateMarkdown.lagda.md"), "utf-8");
    const result = extractLiterateCode("LiterateMarkdown.lagda.md", content);

    expect(result.format).toBe("markdown");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateMarkdown where");
    expect(result.code).toContain("data Nat : Set where");
    // Should not contain markdown wrapper
    expect(result.code).not.toContain("# Literate Markdown");
    expect(result.code).not.toContain("```agda");
    expect(result.code).not.toContain("```");
  });

  it("extracts from LiterateOrg.lagda.org", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateOrg.lagda.org"), "utf-8");
    const result = extractLiterateCode("LiterateOrg.lagda.org", content);

    expect(result.format).toBe("org");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateOrg where");
    expect(result.code).not.toContain("#+begin_src");
    expect(result.code).not.toContain("#+TITLE");
  });

  it("extracts from LiterateRst.lagda.rst", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateRst.lagda.rst"), "utf-8");
    const result = extractLiterateCode("LiterateRst.lagda.rst", content);

    expect(result.format).toBe("rst");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateRst where");
    // RST code blocks are indented — the extracted code preserves indentation
    expect(result.code).toContain("data Nat : Set where");
    expect(result.code).not.toContain("Literate reStructuredText");
    expect(result.code).not.toContain("=========================");
  });

  it("extracts from LiterateTree.lagda.tree", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateTree.lagda.tree"), "utf-8");
    const result = extractLiterateCode("LiterateTree.lagda.tree", content);

    expect(result.format).toBe("tree");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateTree where");
    expect(result.code).not.toContain("\\agda{");
    expect(result.code).not.toContain("\\title");
  });

  it("extracts from LiterateTypst.lagda.typ", () => {
    const content = readFileSync(resolve(FIXTURES, "LiterateTypst.lagda.typ"), "utf-8");
    const result = extractLiterateCode("LiterateTypst.lagda.typ", content);

    expect(result.format).toBe("typst");
    expect(result.blocks).toHaveLength(1);
    expect(result.code).toContain("module LiterateTypst where");
    expect(result.code).not.toContain("```agda");
    expect(result.code).not.toContain("= Literate Typst");
  });

  it("passes through plain .agda files unchanged", () => {
    const content = readFileSync(resolve(FIXTURES, "CompleteFixture.agda"), "utf-8");
    const result = extractLiterateCode("CompleteFixture.agda", content);

    expect(result.format).toBeNull();
    expect(result.code).toBe(content);
    expect(result.blocks).toHaveLength(1);
  });
});

describe("extractLiterateCode edge cases", () => {
  it("handles empty content", () => {
    const result = extractLiterateCode("Module.lagda.md", "");
    expect(result.format).toBe("markdown");
    expect(result.blocks).toHaveLength(0);
    expect(result.code).toBe("");
  });

  it("handles literate file with no code blocks", () => {
    const content = "# Just prose\n\nNo code here.\n";
    const result = extractLiterateCode("Module.lagda.md", content);
    expect(result.format).toBe("markdown");
    expect(result.blocks).toHaveLength(0);
    expect(result.code).toBe("");
  });

  it("handles multiple code blocks in markdown", () => {
    const content = [
      "# Module",
      "",
      "```agda",
      "module Multi where",
      "```",
      "",
      "Some prose.",
      "",
      "```agda",
      "data Bool : Set where",
      "  true false : Bool",
      "```",
    ].join("\n");
    const result = extractLiterateCode("Multi.lagda.md", content);
    expect(result.format).toBe("markdown");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].code).toBe("module Multi where");
    expect(result.blocks[1].code).toContain("data Bool : Set where");
  });

  it("handles multiple code blocks in latex", () => {
    const content = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\begin{code}",
      "module Multi where",
      "\\end{code}",
      "Some prose.",
      "\\begin{code}",
      "data Bool : Set where",
      "  true false : Bool",
      "\\end{code}",
      "\\end{document}",
    ].join("\n");
    const result = extractLiterateCode("Multi.lagda", content);
    expect(result.format).toBe("latex");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].code).toBe("module Multi where");
    expect(result.blocks[1].code).toContain("data Bool : Set where");
  });

  it("handles org with case-insensitive delimiters", () => {
    const content = [
      "#+BEGIN_SRC agda2",
      "module Org where",
      "#+END_SRC",
    ].join("\n");
    const result = extractLiterateCode("Org.lagda.org", content);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].code).toBe("module Org where");
  });

  it("ignores non-agda fenced blocks", () => {
    const content = [
      "```haskell",
      "not agda",
      "```",
      "",
      "```agda",
      "module Real where",
      "```",
    ].join("\n");
    const result = extractLiterateCode("M.lagda.md", content);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].code).toBe("module Real where");
  });
});
