import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  validateProfileOptions,
  toProfileArgs,
  PROFILE_OPTIONS,
  VALID_PROFILE_OPTION_STRINGS,
} from "../../../src/protocol/profile-options.js";

// ── Totality: validateProfileOptions never throws ────────────────────

test("validateProfileOptions is total — never throws on arbitrary string arrays", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 20 }),
      (input) => {
        const result = validateProfileOptions(input);
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
      fc.array(fc.string(), { maxLength: 10 }),
      (input) => {
        const result = validateProfileOptions(input);
        expect(result.valid).toBe(result.errors.length === 0);
      },
    ),
  );
});

// ── Individual valid options always validate ──────────────────────────

test("any single valid profile option always validates successfully", async () => {
  await fc.assert(
    fc.property(
      fc.constantFrom(...PROFILE_OPTIONS),
      (opt) => {
        const result = validateProfileOptions([opt]);
        expect(result.valid).toBe(true);
        expect(result.options).toContain(opt);
      },
    ),
  );
});

// ── Mutual exclusivity invariant ─────────────────────────────────────

test("result never contains two mutually exclusive options", async () => {
  const mutuallyExclusive = ["internal", "modules", "definitions"] as const;

  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...VALID_PROFILE_OPTION_STRINGS), { maxLength: 15 }),
      (input) => {
        const result = validateProfileOptions(input);
        const active = result.options.filter((o) =>
          mutuallyExclusive.includes(o as typeof mutuallyExclusive[number]),
        );
        expect(active.length).toBeLessThanOrEqual(1);
      },
    ),
  );
});

// ── Idempotence: validating the output again gives same result ───────

test("validating the output options again is idempotent", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...VALID_PROFILE_OPTION_STRINGS), { maxLength: 10 }),
      (input) => {
        const first = validateProfileOptions(input);
        if (!first.valid) return; // skip invalid inputs for idempotence test
        const second = validateProfileOptions(first.options);
        expect(second.valid).toBe(true);
        expect(second.options.sort()).toEqual(first.options.sort());
      },
    ),
  );
});

// ── toProfileArgs output invariants ──────────────────────────────────

test("toProfileArgs produces correct number of args and format", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...PROFILE_OPTIONS), { maxLength: 11 }),
      (options) => {
        const args = toProfileArgs(options);
        expect(args.length).toBe(options.length);
        for (let i = 0; i < args.length; i++) {
          expect(args[i]).toBe(`--profile=${options[i]}`);
        }
      },
    ),
  );
});

// ── Subset: output options are always a subset of PROFILE_OPTIONS ────

test("validated options are always a subset of PROFILE_OPTIONS", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 15 }),
      (input) => {
        const result = validateProfileOptions(input);
        for (const opt of result.options) {
          expect((PROFILE_OPTIONS as readonly string[]).includes(opt)).toBe(true);
        }
      },
    ),
  );
});

// ── No duplicates in output ──────────────────────────────────────────

test("validated options never contain duplicates", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...VALID_PROFILE_OPTION_STRINGS), { maxLength: 20 }),
      (input) => {
        const result = validateProfileOptions(input);
        const unique = new Set(result.options);
        expect(unique.size).toBe(result.options.length);
      },
    ),
  );
});

// ── "all" expansion always adds at least all non-exclusive options ────

test("'all' always includes all non-exclusive options", async () => {
  const nonExclusive = PROFILE_OPTIONS.filter(
    (o) => !["internal", "modules", "definitions"].includes(o),
  );

  await fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...VALID_PROFILE_OPTION_STRINGS), { minLength: 0, maxLength: 5 }),
      (prefix) => {
        const input = [...prefix, "all"];
        const result = validateProfileOptions(input);
        if (!result.valid) return;
        for (const opt of nonExclusive) {
          expect(result.options).toContain(opt);
        }
      },
    ),
  );
});
