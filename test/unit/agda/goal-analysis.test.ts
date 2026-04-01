import { test, expect } from "vitest";

import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
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
