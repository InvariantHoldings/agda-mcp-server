import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { escapeAgdaString, extractMessage } from "../../../src/agda-process.js";

// ── escapeAgdaString properties ──────────────────────────

test("escapeAgdaString: every backslash is followed by \\, \", or n", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const escaped = escapeAgdaString(input);
      for (let i = 0; i < escaped.length; i++) {
        if (escaped[i] === "\\") {
          expect(i + 1 < escaped.length).toBeTruthy();
          const next = escaped[i + 1];
          expect(
            next === "\\" || next === '"' || next === "n",
          ).toBeTruthy();
          i++; // skip the escaped character
        }
      }
    }),
  );
});

test("escapeAgdaString: output length >= input length", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      expect(escapeAgdaString(input).length >= input.length).toBeTruthy();
    }),
  );
});

test("escapeAgdaString: empty string → empty string", () => {
  expect(escapeAgdaString("")).toBe("");
});

test("escapeAgdaString: plain alphanumeric is identity", async () => {
  await fc.assert(
    fc.property(
      fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ") }),
      (input) => {
        expect(escapeAgdaString(input)).toBe(input);
      },
    ),
  );
});

// ── extractMessage properties ────────────────────────────

test("extractMessage: always returns a string", async () => {
  await fc.assert(
    fc.property(
      fc.oneof(
        fc.record({ message: fc.string() }),
        fc.record({ payload: fc.string() }),
        fc.record({ text: fc.string() }),
        fc.record({ contents: fc.string() }),
        fc.record({ goalInfo: fc.record({ text: fc.string() }) }),
        fc.record({
          visibleGoals: fc.array(fc.string()),
          errors: fc.array(fc.string()),
        }),
        fc.constant({}),
      ),
      (info) => {
        const result = extractMessage(info);
        expect(typeof result).toBe("string");
      },
    ),
  );
});

test("extractMessage: never throws on arbitrary objects", async () => {
  await fc.assert(
    fc.property(fc.object(), (obj) => {
      const result = extractMessage(obj);
      expect(typeof result).toBe("string");
    }),
  );
});

test("extractMessage: message field has highest priority", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (msg, payload) => {
      expect(extractMessage({ message: msg, payload })).toBe(msg);
    }),
  );
});

test("extractMessage: non-empty input produces non-empty output", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (msg) => {
      expect(extractMessage({ message: msg }).length > 0).toBeTruthy();
    }),
  );
});
