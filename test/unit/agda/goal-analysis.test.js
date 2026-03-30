import test from "node:test";
import assert from "node:assert/strict";

import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
} from "../../../dist/agda/goal-analysis.js";

// ── parseContextEntry ────────────────────────────────────

test("parseContextEntry: simple binding", () => {
  const entry = parseContextEntry("x : Nat");
  assert.equal(entry.name, "x");
  assert.equal(entry.type, "Nat");
  assert.equal(entry.isImplicit, false);
});

test("parseContextEntry: function type binding", () => {
  const entry = parseContextEntry("f : Nat → Bool");
  assert.equal(entry.name, "f");
  assert.equal(entry.type, "Nat → Bool");
  assert.equal(entry.isImplicit, false);
});

test("parseContextEntry: implicit binding", () => {
  const entry = parseContextEntry("{A : Set}");
  assert.equal(entry.name, "A");
  assert.equal(entry.type, "Set");
  assert.equal(entry.isImplicit, true);
});

test("parseContextEntry: complex type with parens", () => {
  const entry = parseContextEntry("p : x ≡ y");
  assert.equal(entry.name, "p");
  assert.equal(entry.type, "x ≡ y");
});

test("parseContextEntry: unparseable falls back gracefully", () => {
  const entry = parseContextEntry("something weird");
  assert.equal(typeof entry.name, "string");
  assert.equal(typeof entry.type, "string");
  assert.equal(entry.isImplicit, false);
});

// ── deriveSuggestions ────────────────────────────────────

test("deriveSuggestions: always includes auto as fallback", () => {
  const suggestions = deriveSuggestions("Nat", []);
  assert.ok(suggestions.some((s) => s.action === "auto"));
});

test("deriveSuggestions: function type suggests refine", () => {
  const suggestions = deriveSuggestions("Nat → Bool", []);
  assert.ok(suggestions.some((s) => s.action === "refine"));
});

test("deriveSuggestions: matching context entry suggests give", () => {
  const context = [{ name: "x", type: "Nat", isImplicit: false }];
  const suggestions = deriveSuggestions("Nat", context);
  assert.ok(suggestions.some((s) => s.action === "give" && s.expr === "x"));
});

test("deriveSuggestions: non-implicit variables suggest case_split", () => {
  const context = [
    { name: "n", type: "Nat", isImplicit: false },
    { name: "A", type: "Set", isImplicit: true },
  ];
  const suggestions = deriveSuggestions("Bool", context);
  assert.ok(suggestions.some((s) => s.action === "case_split" && s.variable === "n"));
  assert.ok(!suggestions.some((s) => s.action === "case_split" && s.variable === "A"));
});

test("deriveSuggestions: equality type suggests refl", () => {
  const suggestions = deriveSuggestions("x ≡ x", []);
  assert.ok(suggestions.some((s) => s.action === "give" && s.expr === "refl"));
});

// ── findMatchingTerms ────────────────────────────────────

test("findMatchingTerms: finds exact type matches", () => {
  const context = [
    { name: "x", type: "Nat", isImplicit: false },
    { name: "f", type: "Nat → Bool", isImplicit: false },
  ];
  const matches = findMatchingTerms("Nat", context);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "x");
});

test("findMatchingTerms: no matches returns empty", () => {
  const context = [{ name: "x", type: "Nat", isImplicit: false }];
  const matches = findMatchingTerms("Bool", context);
  assert.equal(matches.length, 0);
});

test("findMatchingTerms: skips implicit entries", () => {
  const context = [
    { name: "A", type: "Set", isImplicit: true },
    { name: "x", type: "Set", isImplicit: false },
  ];
  const matches = findMatchingTerms("Set", context);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "x");
});
