// MIT License — see LICENSE
//
// Stress tests: exhaustive edge-case coverage for tool paths that
// are lightly exercised by the unit suite. Each section exercises
// one tool family against normal, boundary, and error-path inputs.

import { test, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerFileTools } from "../../../src/tools/file-tools.js";
import { register as registerCacheTools } from "../../../src/tools/cache-tools.js";
import { register as registerImpactTool } from "../../../src/tools/impact-tool.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

// ── Harness ────────────────────────────────────────────────────────

function createCapturingServer() {
  const reg = new Map<string, (args: unknown) => Promise<unknown>>();
  return {
    registerTool(_name: string, _spec: unknown, cb: (a: unknown) => unknown) {
      reg.set(_name, cb as (a: unknown) => Promise<unknown>);
    },
    async call(name: string, args: unknown = {}) {
      const cb = reg.get(name);
      if (!cb) throw new Error(`Tool not registered: ${name}`);
      return cb(args) as Promise<{ isError?: boolean; content: Array<{ text: string }>; structuredContent?: { data: Record<string, unknown> } }>;
    },
  };
}

const stubSession = {
  getAgdaVersion: () => null,
  getLastClassification: () => null,
} as unknown as import("../../../src/agda-process.js").AgdaSession;

let sandbox: string;
let server: ReturnType<typeof createCapturingServer>;

beforeEach(() => {
  clearToolManifest();
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-stress-"));
  server = createCapturingServer();
  registerFileTools(server as unknown as McpServer, stubSession, sandbox);
  registerCacheTools(server as unknown as McpServer, stubSession, sandbox);
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  clearToolManifest();
});

// ── agda_read_module — stress edge cases ──────────────────────────

test("agda_read_module: plain .agda with codeOnly=false returns full content", async () => {
  writeFileSync(resolve(sandbox, "Plain.agda"), "module Plain where\nfoo : Set\nfoo = Set\n");
  const result = await server.call("agda_read_module", { file: "Plain.agda", codeOnly: false });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("module Plain");
  expect(result.content[0].text).toContain("1 |");
});

test("agda_read_module: plain .agda with codeOnly=true returns same as false (no effect)", async () => {
  writeFileSync(resolve(sandbox, "Plain.agda"), "module Plain where\nfoo : Set\nfoo = Set\n");
  const result = await server.call("agda_read_module", { file: "Plain.agda", codeOnly: true });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("module Plain");
  expect(result.content[0].text).toContain("```agda");
});

test("agda_read_module: .lagda.md with codeOnly=true extracts code blocks", async () => {
  writeFileSync(
    resolve(sandbox, "Lit.lagda.md"),
    "# My Proof\n\nSome prose.\n\n```agda\nmodule Lit where\nfoo : Set\nfoo = Set\n```\n\nMore prose.\n",
  );
  const result = await server.call("agda_read_module", { file: "Lit.lagda.md", codeOnly: true });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("code only");
  expect(text).toContain("module Lit");
  expect(text).not.toContain("Some prose");
  expect(text).not.toContain("More prose");
});

test("agda_read_module: .lagda.md with codeOnly=false returns raw file including prose", async () => {
  writeFileSync(
    resolve(sandbox, "Lit.lagda.md"),
    "# My Proof\n\nSome prose.\n\n```agda\nmodule Lit where\n```\n",
  );
  const result = await server.call("agda_read_module", { file: "Lit.lagda.md", codeOnly: false });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("Some prose");
  expect(text).toContain("module Lit");
});

test("agda_read_module: .lagda.md with no agda blocks and codeOnly=true returns informative message", async () => {
  writeFileSync(
    resolve(sandbox, "NoBlocks.lagda.md"),
    "# Just prose\n\nNo code here.\n",
  );
  const result = await server.call("agda_read_module", { file: "NoBlocks.lagda.md", codeOnly: true });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("No Agda code blocks found");
});

test("agda_read_module: .lagda.tex with codeOnly=true extracts \\begin{code} blocks", async () => {
  writeFileSync(
    resolve(sandbox, "Tex.lagda.tex"),
    "\\begin{document}\nSome prose.\n\\begin{code}\nmodule Tex where\nfoo : Set\n\\end{code}\nMore prose.\n\\end{document}\n",
  );
  const result = await server.call("agda_read_module", { file: "Tex.lagda.tex", codeOnly: true });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("module Tex");
  expect(text).not.toContain("Some prose");
});

test("agda_read_module: .lagda.rst with codeOnly=true extracts :: indented blocks (Agda RST format)", async () => {
  // Agda's .lagda.rst uses RST's :: shorthand: a bare :: line followed by an indented block
  writeFileSync(
    resolve(sandbox, "Rst.lagda.rst"),
    "Some prose.\n\n::\n\n  module Rst where\n  foo : Set\n  foo = Set\n\nMore prose.\n",
  );
  const result = await server.call("agda_read_module", { file: "Rst.lagda.rst", codeOnly: true });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("module Rst");
  expect(text).not.toContain("Some prose");
});

test("agda_read_module: file not found returns error", async () => {
  const result = await server.call("agda_read_module", { file: "NotHere.agda" });
  expect(result.isError).toBe(true);
});

test("agda_read_module: path traversal attempt is sandboxed", async () => {
  const result = await server.call("agda_read_module", { file: "../../../etc/passwd" });
  expect(result.isError).toBe(true);
});

test("agda_read_module: empty .agda file returns header with empty code block", async () => {
  writeFileSync(resolve(sandbox, "Empty.agda"), "");
  const result = await server.call("agda_read_module", { file: "Empty.agda" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("Empty.agda");
  expect(result.content[0].text).toContain("```agda");
});

test("agda_read_module: nested path is resolved correctly", async () => {
  mkdirSync(resolve(sandbox, "Deep", "Nested"), { recursive: true });
  writeFileSync(resolve(sandbox, "Deep", "Nested", "Module.agda"), "module Deep.Nested.Module where\n");
  const result = await server.call("agda_read_module", { file: "Deep/Nested/Module.agda" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("module Deep.Nested.Module");
});

// ── agda_check_postulates — improved extraction stress tests ──────

test("agda_check_postulates: no postulates returns clean message", async () => {
  writeFileSync(resolve(sandbox, "Clean.agda"), "module Clean where\nfoo : Set\nfoo = Set\n");
  const result = await server.call("agda_check_postulates", { file: "Clean.agda" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("Clean.agda");
  expect(result.content[0].text).toMatch(/[Nn]o postulate/);
});

test("agda_check_postulates: single block postulate reports identifier names", async () => {
  writeFileSync(
    resolve(sandbox, "WithPost.agda"),
    "module WithPost where\npostulate\n  axiom : Set\n",
  );
  const result = await server.call("agda_check_postulates", { file: "WithPost.agda" });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("axiom");
  expect(text).toMatch(/1 postulate block/i);
});

test("agda_check_postulates: multi-declaration block reports all names", async () => {
  writeFileSync(
    resolve(sandbox, "MultiPost.agda"),
    "module MultiPost where\npostulate\n  ax1 : Set\n  ax2 : Set → Set\n",
  );
  const result = await server.call("agda_check_postulates", { file: "MultiPost.agda" });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("ax1");
  expect(text).toContain("ax2");
  expect(text).toContain("2 identifiers");
});

test("agda_check_postulates: inline postulate is reported", async () => {
  writeFileSync(
    resolve(sandbox, "Inline.agda"),
    "module Inline where\npostulate myAxiom : Set\n",
  );
  const result = await server.call("agda_check_postulates", { file: "Inline.agda" });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("myAxiom");
});

test("agda_check_postulates: multiple postulate blocks are all reported", async () => {
  writeFileSync(
    resolve(sandbox, "TwoBlocks.agda"),
    "module TwoBlocks where\npostulate\n  p1 : Set\n\nfoo : Set\nfoo = Set\n\npostulate\n  p2 : Set\n",
  );
  const result = await server.call("agda_check_postulates", { file: "TwoBlocks.agda" });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("p1");
  expect(text).toContain("p2");
  expect(text).toMatch(/2 postulate blocks/i);
});

test("agda_check_postulates: file not found returns error", async () => {
  const result = await server.call("agda_check_postulates", { file: "Ghost.agda" });
  expect(result.isError).toBe(true);
});

test("agda_check_postulates: path traversal is sandboxed", async () => {
  const result = await server.call("agda_check_postulates", { file: "../../outside.agda" });
  expect(result.isError).toBe(true);
});

test("agda_check_postulates: empty file has no postulates", async () => {
  writeFileSync(resolve(sandbox, "Empty.agda"), "");
  const result = await server.call("agda_check_postulates", { file: "Empty.agda" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toMatch(/[Nn]o postulate/);
});

// ── agda_list_modules — limit and boundary stress ─────────────────

function writeAgdaTier(tier: string, files: Array<[string, string]>) {
  const tierDir = resolve(sandbox, "agda", tier);
  mkdirSync(tierDir, { recursive: true });
  for (const [name, content] of files) {
    writeFileSync(resolve(tierDir, name), content);
  }
}

test("agda_list_modules: large offset beyond total returns empty page message", async () => {
  writeAgdaTier("Foundation", [["OnlyOne.agda", "module OnlyOne where\n"]]);
  const result = await server.call("agda_list_modules", { tier: "Foundation", offset: 9999 });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  // Shows past-end message and total
  expect(text).toContain("1"); // Total is 1
  expect(text).toContain("9999"); // Shows the offset
});

test("agda_list_modules: pattern with no matches returns empty page with total", async () => {
  writeAgdaTier("Foundation", [
    ["Alpha.agda", "module Alpha where\n"],
    ["Beta.agda", "module Beta where\n"],
  ]);
  const result = await server.call("agda_list_modules", { tier: "Foundation", pattern: "zzznomatch" });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("0 matches");
  expect(text).toContain("2 modules");
});

test("agda_list_modules: pattern match is case-insensitive", async () => {
  writeAgdaTier("Foundation", [
    ["FooBar.agda", "module FooBar where\n"],
    ["Baz.agda", "module Baz where\n"],
  ]);
  const lower = await server.call("agda_list_modules", { tier: "Foundation", pattern: "foobar" });
  const upper = await server.call("agda_list_modules", { tier: "Foundation", pattern: "FOOBAR" });
  expect(lower.isError).toBeFalsy();
  expect(upper.isError).toBeFalsy();
  expect(lower.content[0].text).toContain("FooBar");
  expect(upper.content[0].text).toContain("FooBar");
});

test("agda_list_modules: empty tier returns 0 modules", async () => {
  writeAgdaTier("Foundation", []);
  const result = await server.call("agda_list_modules", { tier: "Foundation" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("0 modules");
});

test("agda_list_modules: non-existent tier returns error", async () => {
  const result = await server.call("agda_list_modules", { tier: "NoSuchTier" });
  expect(result.isError).toBe(true);
});

test("agda_list_modules: limit=1 returns exactly one module", async () => {
  writeAgdaTier("Foundation", [
    ["A.agda", "module A where\n"],
    ["B.agda", "module B where\n"],
    ["C.agda", "module C where\n"],
  ]);
  const result = await server.call("agda_list_modules", { tier: "Foundation", limit: 1 });
  expect(result.isError).toBeFalsy();
  const text = result.content[0].text;
  expect(text).toContain("**Showing:** 1–1 of 3.");
  expect(text).toContain("More results available");
});

// ── agda_search_definitions — stress edge cases ───────────────────

function writeAgdaRoot(name: string, content: string) {
  // agda_search_definitions without tier searches agda/ subdirectory
  mkdirSync(resolve(sandbox, "agda"), { recursive: true });
  writeFileSync(resolve(sandbox, "agda", name), content);
}

test("agda_search_definitions: query not found returns empty result", async () => {
  writeAgdaRoot("Foo.agda", "module Foo where\nbar : Set\nbar = Set\n");
  const result = await server.call("agda_search_definitions", { query: "xyznosuchthing" });
  expect(result.isError).toBeFalsy();
  // Should complete without error, returning no matches
  expect(result.content[0].text).toBeTruthy();
});

test("agda_search_definitions: query finds matching identifier", async () => {
  writeAgdaRoot("A.agda", "module A where\nmyFunc : Set\nmyFunc = Set\n");
  writeAgdaRoot("B.agda", "module B where\nother : Set\nother = Set\n");
  const result = await server.call("agda_search_definitions", { query: "myFunc" });
  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toContain("A.agda");
  expect(result.content[0].text).not.toContain("B.agda");
});

test("agda_search_definitions: path traversal in tier is sandboxed", async () => {
  const result = await server.call("agda_search_definitions", { query: "foo", tier: "../../" });
  expect(result.isError).toBe(true);
});

// ── agda_impact — stress edge cases ──────────────────────────────

test("agda_impact: file with no imports has empty dependents and dependencies", async () => {
  writeFileSync(resolve(sandbox, "Leaf.agda"), "module Leaf where\nx : Set\nx = Set\n");
  const result = await server.call("agda_impact", { file: "Leaf.agda" });
  expect(result.isError).toBeFalsy();
  const data = result.structuredContent!.data;
  expect(data.directDependents).toEqual([]);
  expect(data.transitiveDependents).toEqual([]);
  expect(data.directDependencies).toEqual([]);
  expect(data.transitiveDependencies).toEqual([]);
});

test("agda_impact: file not found returns error", async () => {
  const result = await server.call("agda_impact", { file: "Ghost.agda" });
  expect(result.isError).toBe(true);
});

test("agda_impact: path traversal is sandboxed", async () => {
  const result = await server.call("agda_impact", { file: "../../outside.agda" });
  expect(result.isError).toBe(true);
});

test("agda_impact: diamond dependency graph counts each file exactly once", async () => {
  // A → B, A → C, B → D, C → D  (diamond)
  writeFileSync(resolve(sandbox, "D.agda"), "module D where\nd : Set\nd = Set\n");
  writeFileSync(resolve(sandbox, "B.agda"), "module B where\nopen import D\n");
  writeFileSync(resolve(sandbox, "C.agda"), "module C where\nopen import D\n");
  writeFileSync(resolve(sandbox, "A.agda"), "module A where\nopen import B\nopen import C\n");

  const result = await server.call("agda_impact", { file: "D.agda" });
  expect(result.isError).toBeFalsy();
  const data = result.structuredContent!.data;
  // D is directly imported by B and C
  expect((data.directDependents as string[]).sort()).toEqual(["B.agda", "C.agda"]);
  // A depends transitively on D (via B and C) — should appear only once
  const transitive = data.transitiveDependents as string[];
  expect(transitive).toContain("A.agda");
  // No duplicates
  expect(new Set(transitive).size).toBe(transitive.length);
});

test("agda_impact: graphSize reflects all unique files in the import graph", async () => {
  writeFileSync(resolve(sandbox, "X.agda"), "module X where\nx : Set\nx = Set\n");
  writeFileSync(resolve(sandbox, "Y.agda"), "module Y where\nopen import X\n");

  const result = await server.call("agda_impact", { file: "X.agda" });
  expect(result.isError).toBeFalsy();
  expect((result.structuredContent!.data.graphSize as number)).toBeGreaterThanOrEqual(2);
});

// ── agda_cache_info — stress edge cases ──────────────────────────

test("agda_cache_info: file not found returns error", async () => {
  const result = await server.call("agda_cache_info", { file: "Ghost.agda" });
  expect(result.isError).toBe(true);
});

test("agda_cache_info: path traversal is sandboxed", async () => {
  const result = await server.call("agda_cache_info", { file: "../../outside.agda" });
  expect(result.isError).toBe(true);
});

test("agda_cache_info: fresh file with no agda-lib has zero artifacts", async () => {
  writeFileSync(resolve(sandbox, "NoLib.agda"), "module NoLib where\n");
  const result = await server.call("agda_cache_info", { file: "NoLib.agda" });
  expect(result.isError).toBeFalsy();
  const data = result.structuredContent!.data;
  expect(data.artifactCount).toBe(0);
});

