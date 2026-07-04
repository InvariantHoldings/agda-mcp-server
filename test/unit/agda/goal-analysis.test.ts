import { test, expect } from "vitest";

import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
  matchTermsByType,
  resultTypeOf,
} from "../../../src/agda/goal-analysis.js";

// ── parseContextEntry ────────────────────────────────────

test("parseContextEntry: simple binding", () => {
  const entry = parseContextEntry("x : Nat");
  expect(entry.name).toBe("x");
  expect(entry.type).toBe("Nat");
  expect(entry.isImplicit).toBe(false);
});

test("parseContextEntry: function type binding", () => {
  const entry = parseContextEntry("f : Nat → Bool");
  expect(entry.name).toBe("f");
  expect(entry.type).toBe("Nat → Bool");
  expect(entry.isImplicit).toBe(false);
});

test("parseContextEntry: implicit binding", () => {
  const entry = parseContextEntry("{A : Set}");
  expect(entry.name).toBe("A");
  expect(entry.type).toBe("Set");
  expect(entry.isImplicit).toBe(true);
});

test("parseContextEntry: complex type with parens", () => {
  const entry = parseContextEntry("p : x ≡ y");
  expect(entry.name).toBe("p");
  expect(entry.type).toBe("x ≡ y");
});

test("parseContextEntry: unparseable falls back gracefully", () => {
  const entry = parseContextEntry("something weird");
  expect(typeof entry.name).toBe("string");
  expect(typeof entry.type).toBe("string");
  expect(entry.isImplicit).toBe(false);
});

// ── deriveSuggestions ────────────────────────────────────

test("deriveSuggestions: always includes auto as fallback", () => {
  const suggestions = deriveSuggestions("Nat", []);
  expect(suggestions.some((s) => s.action === "auto")).toBeTruthy();
});

test("deriveSuggestions: function type suggests refine", () => {
  const suggestions = deriveSuggestions("Nat → Bool", []);
  expect(suggestions.some((s) => s.action === "refine")).toBeTruthy();
});

test("deriveSuggestions: matching context entry suggests give", () => {
  const context = [{ name: "x", type: "Nat", isImplicit: false }];
  const suggestions = deriveSuggestions("Nat", context);
  expect(suggestions.some((s) => s.action === "give" && s.expr === "x")).toBeTruthy();
});

test("deriveSuggestions: non-implicit variables suggest case_split", () => {
  const context = [
    { name: "n", type: "Nat", isImplicit: false },
    { name: "A", type: "Set", isImplicit: true },
  ];
  const suggestions = deriveSuggestions("Bool", context);
  expect(suggestions.some((s) => s.action === "case_split" && s.variable === "n")).toBeTruthy();
  expect(!suggestions.some((s) => s.action === "case_split" && s.variable === "A")).toBeTruthy();
});

test("deriveSuggestions: equality type suggests refl", () => {
  const suggestions = deriveSuggestions("x ≡ x", []);
  expect(suggestions.some((s) => s.action === "give" && s.expr === "refl")).toBeTruthy();
});

test("deriveSuggestions: case_split skips ambiguous duplicate names", () => {
  const suggestions = deriveSuggestions("Nat", [
    { name: "x", type: "Nat", isImplicit: false },
    { name: "x", type: "Set", isImplicit: true },
  ]);

  expect(!suggestions.some((s) => s.action === "case_split" && s.variable === "x")).toBeTruthy();
});

// ── findMatchingTerms ────────────────────────────────────

test("findMatchingTerms: finds exact type matches", () => {
  const context = [
    { name: "x", type: "Nat", isImplicit: false },
    { name: "f", type: "Nat → Bool", isImplicit: false },
  ];
  const matches = findMatchingTerms("Nat", context);
  expect(matches.length).toBe(1);
  expect(matches[0].name).toBe("x");
});

test("findMatchingTerms: no matches returns empty", () => {
  const context = [{ name: "x", type: "Nat", isImplicit: false }];
  const matches = findMatchingTerms("Bool", context);
  expect(matches.length).toBe(0);
});

test("findMatchingTerms: skips implicit entries", () => {
  const context = [
    { name: "A", type: "Set", isImplicit: true },
    { name: "x", type: "Set", isImplicit: false },
  ];
  const matches = findMatchingTerms("Set", context);
  expect(matches.length).toBe(1);
  expect(matches[0].name).toBe("x");
});

// ── resultTypeOf ─────────────────────────────────────────

test("resultTypeOf: non-function type is itself with arity 0", () => {
  expect(resultTypeOf("Nat")).toEqual({ resultType: "Nat", arity: 0 });
});

test("resultTypeOf: strips top-level arrows and counts arguments", () => {
  expect(resultTypeOf("Nat → Nat")).toEqual({ resultType: "Nat", arity: 1 });
  expect(resultTypeOf("Nat → Nat → Nat")).toEqual({ resultType: "Nat", arity: 2 });
});

test("resultTypeOf: ascii arrows and dependent function types", () => {
  expect(resultTypeOf("A -> B -> C")).toEqual({ resultType: "C", arity: 2 });
  expect(resultTypeOf("(x : Nat) → P x")).toEqual({ resultType: "P x", arity: 1 });
});

test("resultTypeOf: does not split arrows nested in parens/braces", () => {
  // The (A → B) argument is one parameter; result is C.
  expect(resultTypeOf("(A → B) → C")).toEqual({ resultType: "C", arity: 1 });
  expect(resultTypeOf("{A : Set} → A → A")).toEqual({ resultType: "A", arity: 2 });
  // Right-nested parenthesized result unwraps fully.
  expect(resultTypeOf("A → (B → C)")).toEqual({ resultType: "C", arity: 2 });
});

// ── matchTermsByType ─────────────────────────────────────

test("matchTermsByType: exact and result-type matches, non-matches dropped", () => {
  const matches = matchTermsByType("Nat", [
    { name: "z", type: "Nat" },
    { name: "s", type: "Nat → Nat" },
    { name: "b", type: "Bool" },
  ]);
  expect(matches.map((m) => m.name)).toEqual(["z", "s"]);
  expect(matches[0]).toMatchObject({ match: "exact", arity: 0 });
  expect(matches[1]).toMatchObject({ match: "result", arity: 1 });
});

test("matchTermsByType: exact sorts before result, then by ascending arity", () => {
  const matches = matchTermsByType("R", [
    { name: "two", type: "A → B → R" },
    { name: "one", type: "A → R" },
    { name: "exact", type: "R" },
  ]);
  expect(matches.map((m) => m.name)).toEqual(["exact", "one", "two"]);
});

test("matchTermsByType: whitespace-insensitive and total on junk", () => {
  expect(matchTermsByType("Nat", [{ name: "x", type: "Nat  " }])[0].match).toBe("exact");
  expect(matchTermsByType("", [{ name: "x", type: "Nat" }])).toEqual([]);
  expect(matchTermsByType("Nat", [{ name: "x", type: "" }])).toEqual([]);
});
