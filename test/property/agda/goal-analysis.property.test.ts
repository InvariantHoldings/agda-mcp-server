import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
} from "../../../src/agda/goal-analysis.js";

// ── parseContextEntry properties ─────────────────────────

test("parseContextEntry: always returns name, type, isImplicit for any string", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const entry = parseContextEntry(input);
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.isImplicit).toBe("boolean");
    }),
  );
});

test("parseContextEntry: well-formed 'name : type' round-trips name", async () => {
  const nameArb = fc.string({
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
    minLength: 1, maxLength: 10,
  });
  const typeArb = fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz→ "),
    minLength: 1, maxLength: 20,
  }).filter((s) => s.trim().length > 0);

  await fc.assert(
    fc.property(nameArb, typeArb, (name, type) => {
      const entry = parseContextEntry(`${name} : ${type}`);
      expect(entry.name).toBe(name);
      expect(entry.type.length > 0).toBeTruthy();
    }),
  );
});

// ── deriveSuggestions properties ──────────────────────────

test("deriveSuggestions: always includes auto for any input", async () => {
  await fc.assert(
    fc.property(fc.string(), (goalType) => {
      const suggestions = deriveSuggestions(goalType, []);
      expect(suggestions.some((s) => s.action === "auto")).toBeTruthy();
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
        expect(typeof s.action).toBe("string");
        expect(s.action.length > 0).toBeTruthy();
        expect(typeof s.reason).toBe("string");
        expect(s.reason.length > 0).toBeTruthy();
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
        expect(!implicitNames.has(s.variable as string)).toBeTruthy();
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
        expect(nonImplicitNames.has(m.name)).toBeTruthy();
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
      expect(Array.isArray(matches)).toBeTruthy();
    }),
  );
});
