import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { parseBackendExpression } from "../../../src/agda/backend-expression.js";

// ── Totality: never crashes on arbitrary strings ──────────

test("parseBackendExpression either returns valid result or throws Error", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      try {
        const result = parseBackendExpression(input);
        // If it returns, expression must be a non-empty trimmed string
        expect(typeof result.expression).toBe("string");
        expect(result.expression.length > 0).toBeTruthy();
        expect(typeof result.displayName).toBe("string");
        expect(result.displayName.length > 0).toBeTruthy();
      } catch (err) {
        // If it throws, must be an Error with a message
        expect(err instanceof Error).toBeTruthy();
        expect((err as Error).message.length > 0).toBeTruthy();
      }
    }),
  );
});

// ── Simple backend: alphanumeric identity ─────────────────

test("simple backend names are preserved as-is in expression", async () => {
  const simpleNameArb = fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"),
    minLength: 1,
  }).filter((s) => /^[A-Za-z]/.test(s));

  await fc.assert(
    fc.property(simpleNameArb, (name) => {
      const result = parseBackendExpression(name);
      expect(result.expression).toBe(name);
      expect(result.displayName).toBe(name);
    }),
  );
});

// ── OtherBackend round-trip: displayName contains the inner name ──

test("OtherBackend displayName includes the unescaped inner name", async () => {
  // Generate names without backslash/quote/newline for simplicity
  const innerNameArb = fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_- "),
    minLength: 1,
  });

  await fc.assert(
    fc.property(innerNameArb, (name) => {
      const input = `OtherBackend "${name}"`;
      const result = parseBackendExpression(input);
      expect(result.displayName.includes(name)).toBeTruthy();
      expect(result.expression).toBe(input);
    }),
  );
});

// ── Whitespace trimming ──────────────────────────────────

test("leading/trailing whitespace is trimmed from expression", async () => {
  const simpleNameArb = fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    minLength: 1,
  }).filter((s) => /^[A-Za-z]/.test(s));

  await fc.assert(
    fc.property(simpleNameArb, fc.string({ unit: fc.constant(" "), minLength: 0, maxLength: 5 }), (name, spaces) => {
      const result = parseBackendExpression(spaces + name + spaces);
      expect(result.expression).toBe(name);
    }),
  );
});

// ── Newlines always rejected ─────────────────────────────

test("strings with internal newlines are always rejected", async () => {
  // Ensure non-empty content on both sides so the newline is internal (not trimmed away)
  const nonEmptyArb = fc.string({
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    minLength: 1,
  });
  await fc.assert(
    fc.property(nonEmptyArb, nonEmptyArb, (before, after) => {
      expect(() => parseBackendExpression(before + "\n" + after)).toThrow();
    }),
  );
});

// ── Empty/whitespace-only always rejected ────────────────

test("empty or whitespace-only strings are always rejected", async () => {
  await fc.assert(
    fc.property(
      fc.string({ unit: fc.constantFrom(" ", "\t"), minLength: 0, maxLength: 10 }),
      (ws) => {
        expect(() => parseBackendExpression(ws)).toThrow(/cannot be empty/i);
      },
    ),
  );
});
