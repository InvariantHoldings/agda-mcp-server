import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildImportGraph,
  computeImpact,
} from "../../../src/agda/import-graph.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-import-graph-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function writeAgda(rel: string, content: string): string {
  const abs = resolve(sandbox, rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

// ── parser primitives ─────────────────────────────────────────────

test("buildImportGraph extracts the module name from a simple file", () => {
  writeAgda("Foo.agda", "module Foo where\nx : Set\nx = Set\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.modules.get("Foo.agda")?.moduleName).toBe("Foo");
});

test("buildImportGraph handles a dotted module name with parameters", () => {
  writeAgda(
    "Foo/Bar.agda",
    "module Foo.Bar {ℓ} (X : Set ℓ) where\n",
  );
  const graph = buildImportGraph(sandbox);
  expect(graph.modules.get("Foo/Bar.agda")?.moduleName).toBe("Foo.Bar");
});

test("buildImportGraph ignores `import` strings inside block comments", () => {
  writeAgda(
    "WithComment.agda",
    [
      "{- This module is *not* about importing Foo,",
      "   even though we say `open import Foo` here. -}",
      "module WithComment where",
      "x : Set",
      "x = Set",
    ].join("\n"),
  );
  const graph = buildImportGraph(sandbox);
  // Only the file itself; no import edges.
  expect(graph.modules.size).toBe(1);
  expect(graph.imports.get("WithComment.agda")).toEqual([]);
});

test("buildImportGraph ignores `import` strings inside line comments", () => {
  writeAgda(
    "WithLineComment.agda",
    [
      "module WithLineComment where",
      "-- open import Foo.Bar  -- this is just a comment",
      "x : Set",
      "x = Set",
    ].join("\n"),
  );
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("WithLineComment.agda")).toEqual([]);
});

test("buildImportGraph handles nested block comments `{- {- nested -} -}`", () => {
  // Agda's block comments nest. An inner `{-` must not fool the
  // stripper into closing on the inner `-}` and then mis-parsing
  // the rest of the text as outside-comment source.
  writeAgda("A.agda", [
    "module A where",
    "{- outer",
    "  {- inner with open import Bogus -}",
    "still inside the outer comment -}",
    "open import B",
  ].join("\n"));
  writeAgda("B.agda", "module B where\n");
  writeAgda("Bogus.agda", "module Bogus where\n");
  const graph = buildImportGraph(sandbox);
  // The real import edge is still captured.
  expect(graph.imports.get("A.agda")).toEqual(["B.agda"]);
  // The fake import buried inside the nested comment is NOT.
  expect(graph.imports.get("A.agda")).not.toContain("Bogus.agda");
});

test("buildImportGraph tolerates an unclosed block comment without crashing", () => {
  // Garbage-in-garbage-out is fine, but the scanner must not throw:
  // one malformed file in a many-hundred-module repo shouldn't take
  // the whole graph build down.
  writeAgda("Broken.agda", [
    "module Broken where",
    "{- this comment is never closed",
    "open import Neighbour",
  ].join("\n"));
  writeAgda("Neighbour.agda", "module Neighbour where\n");
  expect(() => buildImportGraph(sandbox)).not.toThrow();
  const graph = buildImportGraph(sandbox);
  // The module still registers (module name parses OK before the
  // opener) and the bogus import inside the unclosed comment is
  // dropped — which is the right call: we can't know where the
  // comment was supposed to end.
  expect(graph.modules.has("Broken.agda")).toBe(true);
  expect(graph.imports.get("Broken.agda")).toEqual([]);
});

test("buildImportGraph treats `{-# ... #-}` pragmas as block comments and doesn't mask real imports", () => {
  // `{-# OPTIONS ... #-}` is a pragma form. It starts with `{-` and
  // ends with `-}`, so the stripper consumes it as a block comment
  // — that's fine, because pragmas don't contain imports. The
  // important thing is the real `open import` below it still shows
  // up in the graph.
  writeAgda("WithPragma.agda", [
    "{-# OPTIONS --no-positivity-check #-}",
    "module WithPragma where",
    "open import Neighbour",
  ].join("\n"));
  writeAgda("Neighbour.agda", "module Neighbour where\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("WithPragma.agda")).toEqual(["Neighbour.agda"]);
});

test("buildImportGraph walker never throws on unreadable sibling subdirs", async (ctx) => {
  const { chmodSync } = await import("node:fs");
  writeAgda("ok/Good.agda", "module Good where\n");
  const blockedDir = resolve(sandbox, "blocked");
  mkdirSync(blockedDir, { recursive: true });
  writeAgda("blocked/Hidden.agda", "module Hidden where\n");

  try {
    chmodSync(blockedDir, 0o000);
  } catch {
    ctx.skip();
    return;
  }
  // Confirm the OS enforces the permission; some CI sandboxes
  // silently ignore chmod on directories.
  try {
    const { readdirSync: rd } = await import("node:fs");
    rd(blockedDir);
    chmodSync(blockedDir, 0o700);
    ctx.skip();
    return;
  } catch { /* expected */ }

  try {
    expect(() => buildImportGraph(sandbox)).not.toThrow();
    // The readable sibling is still picked up.
    const graph = buildImportGraph(sandbox);
    expect(graph.modules.has("ok/Good.agda")).toBe(true);
    expect(graph.modules.has("blocked/Hidden.agda")).toBe(false);
  } finally {
    chmodSync(blockedDir, 0o700);
  }
});

// ── direct + transitive import edges ─────────────────────────────

test("buildImportGraph captures a direct open-import edge", () => {
  writeAgda("A.agda", "module A where\nopen import B\n");
  writeAgda("B.agda", "module B where\nx : Set\nx = Set\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("A.agda")).toEqual(["B.agda"]);
  expect(graph.importedBy.get("B.agda")).toEqual(["A.agda"]);
});

test("buildImportGraph captures bare `import` (without `open`)", () => {
  writeAgda("A.agda", "module A where\nimport B\n");
  writeAgda("B.agda", "module B where\nx : Set\nx = Set\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("A.agda")).toEqual(["B.agda"]);
});

test("buildImportGraph drops `using`/`hiding`/`renaming`/`as` clauses from the import target", () => {
  writeAgda("A.agda", "module A where\nopen import B using (x; y)\nopen import C as C′ hiding (z)\nopen import D renaming (w to w′)\n");
  writeAgda("B.agda", "module B where\n");
  writeAgda("C.agda", "module C where\n");
  writeAgda("D.agda", "module D where\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("A.agda")).toEqual(["B.agda", "C.agda", "D.agda"]);
});

test("buildImportGraph dedupes repeated imports of the same module", () => {
  writeAgda(
    "A.agda",
    "module A where\nopen import B\nopen import B using (foo)\n",
  );
  writeAgda("B.agda", "module B where\n");
  const graph = buildImportGraph(sandbox);
  expect(graph.imports.get("A.agda")).toEqual(["B.agda"]);
  expect(graph.importedBy.get("B.agda")).toEqual(["A.agda"]);
});

// ── computeImpact ────────────────────────────────────────────────

test("computeImpact returns direct + transitive dependents along a chain", () => {
  // Chain: D → C → B → A (each imports the next, A is the leaf)
  writeAgda("A.agda", "module A where\nx : Set\nx = Set\n");
  writeAgda("B.agda", "module B where\nopen import A\n");
  writeAgda("C.agda", "module C where\nopen import B\n");
  writeAgda("D.agda", "module D where\nopen import C\n");
  // E doesn't depend on A at all — it should not appear.
  writeAgda("E.agda", "module E where\nx : Set\nx = Set\n");

  const graph = buildImportGraph(sandbox);
  const impact = computeImpact(graph, sandbox, "A.agda");
  expect(impact).not.toBeNull();
  expect(impact!.directDependents).toEqual(["B.agda"]);
  expect(impact!.transitiveDependents).toEqual(["B.agda", "C.agda", "D.agda"]);
  expect(impact!.directDependencies).toEqual([]);
  expect(impact!.transitiveDependencies).toEqual([]);
});

test("computeImpact returns direct + transitive dependencies for a top consumer", () => {
  writeAgda("A.agda", "module A where\n");
  writeAgda("B.agda", "module B where\nopen import A\n");
  writeAgda("C.agda", "module C where\nopen import B\n");
  writeAgda("D.agda", "module D where\nopen import C\nopen import A\n");

  const graph = buildImportGraph(sandbox);
  const impact = computeImpact(graph, sandbox, "D.agda");
  expect(impact).not.toBeNull();
  expect(impact!.directDependencies).toEqual(["A.agda", "C.agda"]);
  expect(impact!.transitiveDependencies).toEqual(["A.agda", "B.agda", "C.agda"]);
  expect(impact!.directDependents).toEqual([]);
  expect(impact!.transitiveDependents).toEqual([]);
});

test("computeImpact handles a diamond — both branches reach the leaf", () => {
  // D → B → A, D → C → A — A is the diamond bottom.
  writeAgda("A.agda", "module A where\n");
  writeAgda("B.agda", "module B where\nopen import A\n");
  writeAgda("C.agda", "module C where\nopen import A\n");
  writeAgda("D.agda", "module D where\nopen import B\nopen import C\n");
  const graph = buildImportGraph(sandbox);
  const impact = computeImpact(graph, sandbox, "A.agda");
  expect(impact!.directDependents).toEqual(["B.agda", "C.agda"]);
  expect(impact!.transitiveDependents).toEqual(["B.agda", "C.agda", "D.agda"]);
});

test("computeImpact tolerates a cycle without spinning", () => {
  // Pathological — Agda would reject this at typecheck time, but
  // our scanner shouldn't crash on it.
  writeAgda("A.agda", "module A where\nopen import B\n");
  writeAgda("B.agda", "module B where\nopen import A\n");
  const graph = buildImportGraph(sandbox);
  const impact = computeImpact(graph, sandbox, "A.agda");
  expect(impact!.transitiveDependents).toEqual(["B.agda"]);
  expect(impact!.transitiveDependencies).toEqual(["B.agda"]);
});

test("computeImpact returns null when the file isn't part of the graph", () => {
  writeAgda("Real.agda", "module Real where\n");
  const graph = buildImportGraph(sandbox);
  expect(computeImpact(graph, sandbox, "Missing.agda")).toBeNull();
});

test("buildImportGraph skips `_build/` and dotfile directories", () => {
  writeAgda("Active.agda", "module Active where\nopen import Vendored\n");
  // Both should be skipped — the vendored Vendored.agda must not
  // appear in the graph and must not be considered a candidate
  // import target either.
  writeAgda("_build/2.9.0/agda/Vendored.agda", "module Vendored where\n");
  writeAgda(".cache/Vendored.agda", "module Vendored where\n");

  const graph = buildImportGraph(sandbox);
  expect([...graph.modules.keys()]).toEqual(["Active.agda"]);
  // `Active.agda` imports `Vendored`, which doesn't resolve to any
  // file in the graph — so the import edge is dropped silently.
  expect(graph.imports.get("Active.agda")).toEqual([]);
});

test("buildImportGraph honours the project's existing FixtureDeps chain", () => {
  // Sanity-check that the parser handles the real fixtures we
  // keep under test/fixtures/agda/FixtureDeps. NatExtra imports
  // NatCore, so impact("NatCore") must include NatExtra.
  const fixturesRoot = resolve(import.meta.dirname, "../../fixtures/agda");
  const graph = buildImportGraph(fixturesRoot);
  const impact = computeImpact(graph, fixturesRoot, "FixtureDeps/NatCore.agda");
  expect(impact).not.toBeNull();
  expect(impact!.directDependents).toContain("FixtureDeps/NatExtra.agda");
  expect(impact!.directDependents).toContain("FixtureDeps/Chain/Functions.agda");
});
