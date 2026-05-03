import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  validateCommandLineOptions,
  COMMON_AGDA_FLAGS,
} from "../../../src/protocol/command-line-options.js";
import { mergeCommandLineOptions } from "../../../src/session/project-config.js";

// ── Totality: validateCommandLineOptions never throws ────────────────

test("validateCommandLineOptions is total — never throws on arbitrary string arrays", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 20 }),
      (input) => {
        const result = validateCommandLineOptions(input);
        expect(typeof result.valid).toBe("boolean");
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.options)).toBe(true);
      },
    ),
  );
});

// ── Validity invariant: valid ↔ no errors ────────────────────────────

test("valid is true iff errors is empty", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 20 }),
      (input) => {
        const result = validateCommandLineOptions(input);
        expect(result.valid).toBe(result.errors.length === 0);
      },
    ),
  );
});

// ── Idempotence: re-validating validated options is identity ──────────

test("validated options pass re-validation unchanged", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 10 }),
      (input) => {
        const first = validateCommandLineOptions(input);
        expect(first.valid).toBe(true);
        const second = validateCommandLineOptions(first.options);
        expect(second.valid).toBe(true);
        expect(second.options).toEqual(first.options);
      },
    ),
  );
});

// ── Deduplication: output never has duplicates ───────────────────────

test("output options have no duplicates", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 15 }),
      (input) => {
        const result = validateCommandLineOptions(input);
        const unique = new Set(result.options);
        expect(result.options.length).toBe(unique.size);
      },
    ),
  );
});

// ── mergeCommandLineOptions preserves all unique elements ────────────

test("merge result contains all unique elements from both inputs", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 5 }),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 5 }),
      (defaults, perCall) => {
        const result = mergeCommandLineOptions(defaults, perCall);
        const allUnique = new Set([...defaults, ...perCall]);
        expect(new Set(result)).toEqual(allUnique);
      },
    ),
  );
});

// ── merge deduplicates ───────────────────────────────────────────────

test("merge result has no duplicates", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 8 }),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 8 }),
      (defaults, perCall) => {
        const result = mergeCommandLineOptions(defaults, perCall);
        expect(result.length).toBe(new Set(result).size);
      },
    ),
  );
});

// ── merge precedence: per-call wins on collision ────────────────────

test("when a flag appears in both inputs, it occupies its per-call position", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom(...COMMON_AGDA_FLAGS),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 5 }),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 5 }),
      (shared, defaultsTail, perCallHead) => {
        const defaults = [shared, ...defaultsTail];
        const perCall = [...perCallHead, shared];
        const result = mergeCommandLineOptions(defaults, perCall);
        expect(result[result.length - 1]).toBe(shared);
        expect(result.indexOf(shared)).toBe(result.length - 1);
      },
    ),
  );
});

// ── merge contents are stable under regrouping ───────────────────────

test("merge groupings agree on which flags appear (set equality)", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 4 }),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 4 }),
      fc.array(fc.constantFrom(...COMMON_AGDA_FLAGS), { maxLength: 4 }),
      (a, b, c) => {
        const left = mergeCommandLineOptions(mergeCommandLineOptions(a, b), c);
        const right = mergeCommandLineOptions(a, mergeCommandLineOptions(b, c));
        // Element ordering can differ — last-wins is associative on sets,
        // not on lists. The invariant we DO want is that both groupings
        // ship the same set of flags to Agda.
        expect(new Set(left)).toEqual(new Set(right));
      },
    ),
  );
});
