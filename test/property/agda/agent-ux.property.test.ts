import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  applyScopedRename,
  buildMissingClause,
  classifyAgdaError,
  matchesTypePattern,
  normalizeConfidence,
  splitWords,
} from "../../../src/agda/agent-ux.js";

test("normalizeConfidence always returns a probability in [0, 1]", async () => {
  await fc.assert(
    fc.property(fc.float({ min: -1000, max: 1000 }), (value) => {
      const out = normalizeConfidence(value);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }),
  );
});

test("buildMissingClause emits exactly N wildcard arguments for positive arity", async () => {
  await fc.assert(
    fc.property(fc.integer({ min: 1, max: 12 }), (arity) => {
      const clause = buildMissingClause("f", arity);
      const wildcardCount = (clause.match(/_/gu) ?? []).length;
      expect(wildcardCount).toBe(arity);
    }),
  );
});

test("applyScopedRename is a no-op when source and target names are identical", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.string({ minLength: 1, maxLength: 12 }),
      (source, name) => {
        const out = applyScopedRename(source, name, name);
        expect(out.updated).toBe(source);
        expect(out.replacements).toBe(0);
      },
    ),
  );
});

test("exact type pattern always matches itself", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 8 }),
      (parts) => {
        const cleaned = parts.map((part) => part.replace(/\s+/gu, "")).filter((part) => part.length > 0);
        fc.pre(cleaned.length > 0);
        const text = cleaned.join(" ");
        expect(matchesTypePattern(text, text)).toBe(true);
      },
    ),
  );
});

test("classifyAgdaError always returns confidence in [0, 1] and a known category", async () => {
  const categories = new Set([
    "mechanical-import",
    "mechanical-rename",
    "parser-regression",
    "coverage-missing",
    "proof-obligation",
    "dep-failure",
    "toolchain",
  ]);

  await fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 512 }), (message) => {
      const out = classifyAgdaError(message);
      expect(categories.has(out.category)).toBe(true);
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
      expect(out.suggestedAction.action.length).toBeGreaterThan(0);
    }),
  );
});

test("splitWords never returns empty tokens", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 256 }), (input) => {
      for (const token of splitWords(input)) {
        expect(token.length).toBeGreaterThan(0);
      }
    }),
  );
});

