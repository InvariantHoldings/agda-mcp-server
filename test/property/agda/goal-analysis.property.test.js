import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
} from "../../../dist/agda/goal-analysis.js";

// ── parseContextEntry properties ─────────────────────────

test("parseContextEntry: always returns name, type, isImplicit for any string", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const entry = parseContextEntry(input);
      assert.equal(typeof entry.name, "string");
      assert.equal(typeof entry.type, "string");
      assert.equal(typeof entry.isImplicit, "boolean");
    }),
  );
});

test("parseContextEntry: well-formed 'name : type' round-trips name", async () => {
  const nameArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
    { minLength: 1, maxLength: 10 },
  );
  const typeArb = fc.stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz→ "),
    { minLength: 1, maxLength: 20 },
  ).filter((s) => s.trim().length > 0);

  await fc.assert(
    fc.property(nameArb, typeArb, (name, type) => {
      const entry = parseContextEntry(`${name} : ${type}`);
      assert.equal(entry.name, name);
      assert.ok(entry.type.length > 0);
    }),
  );
});

// ── deriveSuggestions properties ──────────────────────────

test("deriveSuggestions: always includes auto for any input", async () => {
  await fc.assert(
    fc.property(fc.string(), (goalType) => {
      const suggestions = deriveSuggestions(goalType, []);
      assert.ok(suggestions.some((s) => s.action === "auto"));
    }),
  );
});

test("deriveSuggestions: every suggestion has action and reason", async () => {
  const contextArb = fc.array(
    fc.record({
      name: fc.string({ minLength: 1 }),
      type: fc.string({ minLength: 1 }),
      isImplicit: fc.boolean(),
    }),
    { maxLength: 5 },
  );

  await fc.assert(
    fc.property(fc.string(), contextArb, (goalType, context) => {
      const suggestions = deriveSuggestions(goalType, context);
      for (const s of suggestions) {
        assert.equal(typeof s.action, "string");
        assert.ok(s.action.length > 0);
        assert.equal(typeof s.reason, "string");
        assert.ok(s.reason.length > 0);
      }
    }),
  );
});

test("deriveSuggestions: case_split only for non-implicit variables", async () => {
  const contextArb = fc.array(
    fc.record({
      name: fc.string({ minLength: 1 }),
      type: fc.string({ minLength: 1 }),
      isImplicit: fc.boolean(),
    }),
    { maxLength: 5 },
  );

  await fc.assert(
    fc.property(fc.string(), contextArb, (goalType, context) => {
      const suggestions = deriveSuggestions(goalType, context);
      const splits = suggestions.filter((s) => s.action === "case_split");
      const implicitNames = new Set(context.filter((e) => e.isImplicit).map((e) => e.name));
      for (const s of splits) {
        assert.ok(!implicitNames.has(s.variable), `should not suggest case_split on implicit ${s.variable}`);
      }
    }),
  );
});

// ── findMatchingTerms properties ─────────────────────────

test("findMatchingTerms: result is always subset of non-implicit context", async () => {
  const contextArb = fc.array(
    fc.record({
      name: fc.string({ minLength: 1 }),
      type: fc.constantFrom("Nat", "Bool", "Set", "Nat → Bool"),
      isImplicit: fc.boolean(),
    }),
    { maxLength: 5 },
  );

  await fc.assert(
    fc.property(fc.constantFrom("Nat", "Bool", "Set"), contextArb, (target, context) => {
      const matches = findMatchingTerms(target, context);
      const nonImplicitNames = new Set(context.filter((e) => !e.isImplicit).map((e) => e.name));
      for (const m of matches) {
        assert.ok(nonImplicitNames.has(m.name));
      }
    }),
  );
});

test("findMatchingTerms: never throws", async () => {
  await fc.assert(
    fc.property(fc.string(), fc.array(fc.record({
      name: fc.string(),
      type: fc.string(),
      isImplicit: fc.boolean(),
    })), (target, context) => {
      const matches = findMatchingTerms(target, context);
      assert.ok(Array.isArray(matches));
    }),
  );
});
