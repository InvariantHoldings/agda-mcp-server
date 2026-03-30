import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { parseBackendExpression } from "../../../dist/agda/backend-expression.js";

// ── Totality: never crashes on arbitrary strings ──────────

test("parseBackendExpression either returns valid result or throws Error", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      try {
        const result = parseBackendExpression(input);
        // If it returns, expression must be a non-empty trimmed string
        assert.equal(typeof result.expression, "string");
        assert.ok(result.expression.length > 0);
        assert.equal(typeof result.displayName, "string");
        assert.ok(result.displayName.length > 0);
      } catch (err) {
        // If it throws, must be an Error with a message
        assert.ok(err instanceof Error);
        assert.ok(err.message.length > 0);
      }
    }),
  );
});

// ── Simple backend: alphanumeric identity ─────────────────

test("simple backend names are preserved as-is in expression", async () => {
  const simpleNameArb = fc.stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"),
    { minLength: 1 },
  ).filter((s) => /^[A-Za-z]/.test(s));

  await fc.assert(
    fc.property(simpleNameArb, (name) => {
      const result = parseBackendExpression(name);
      assert.equal(result.expression, name);
      assert.equal(result.displayName, name);
    }),
  );
});

// ── OtherBackend round-trip: displayName contains the inner name ──

test("OtherBackend displayName includes the unescaped inner name", async () => {
  // Generate names without backslash/quote/newline for simplicity
  const innerNameArb = fc.stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_- "),
    { minLength: 1 },
  );

  await fc.assert(
    fc.property(innerNameArb, (name) => {
      const input = `OtherBackend "${name}"`;
      const result = parseBackendExpression(input);
      assert.ok(result.displayName.includes(name));
      assert.equal(result.expression, input);
    }),
  );
});

// ── Whitespace trimming ──────────────────────────────────

test("leading/trailing whitespace is trimmed from expression", async () => {
  const simpleNameArb = fc.stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    { minLength: 1 },
  ).filter((s) => /^[A-Za-z]/.test(s));

  await fc.assert(
    fc.property(simpleNameArb, fc.stringOf(fc.constant(" "), { minLength: 0, maxLength: 5 }), (name, spaces) => {
      const result = parseBackendExpression(spaces + name + spaces);
      assert.equal(result.expression, name);
    }),
  );
});

// ── Newlines always rejected ─────────────────────────────

test("strings with internal newlines are always rejected", async () => {
  // Ensure non-empty content on both sides so the newline is internal (not trimmed away)
  const nonEmptyArb = fc.stringOf(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    { minLength: 1 },
  );
  await fc.assert(
    fc.property(nonEmptyArb, nonEmptyArb, (before, after) => {
      assert.throws(() => parseBackendExpression(before + "\n" + after));
    }),
  );
});

// ── Empty/whitespace-only always rejected ────────────────

test("empty or whitespace-only strings are always rejected", async () => {
  await fc.assert(
    fc.property(
      fc.stringOf(fc.constantFrom(" ", "\t"), { minLength: 0, maxLength: 10 }),
      (ws) => {
        assert.throws(() => parseBackendExpression(ws), /cannot be empty/i);
      },
    ),
  );
});
