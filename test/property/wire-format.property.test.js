import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { escapeAgdaString, extractMessage } from "../../dist/agda-process.js";

// ── escapeAgdaString properties ──────────────────────────

test("escapeAgdaString: every backslash is followed by \\, \", or n", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      const escaped = escapeAgdaString(input);
      for (let i = 0; i < escaped.length; i++) {
        if (escaped[i] === "\\") {
          assert.ok(i + 1 < escaped.length, "trailing backslash");
          const next = escaped[i + 1];
          assert.ok(
            next === "\\" || next === '"' || next === "n",
            `unexpected escape \\${next}`,
          );
          i++; // skip the escaped character
        }
      }
    }),
  );
});

test("escapeAgdaString: output length >= input length", async () => {
  await fc.assert(
    fc.property(fc.string(), (input) => {
      assert.ok(escapeAgdaString(input).length >= input.length);
    }),
  );
});

test("escapeAgdaString: empty string → empty string", () => {
  assert.equal(escapeAgdaString(""), "");
});

test("escapeAgdaString: plain alphanumeric is identity", async () => {
  await fc.assert(
    fc.property(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ")),
      (input) => {
        assert.equal(escapeAgdaString(input), input);
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
        assert.equal(typeof result, "string");
      },
    ),
  );
});

test("extractMessage: never throws on arbitrary objects", async () => {
  await fc.assert(
    fc.property(fc.object(), (obj) => {
      const result = extractMessage(obj);
      assert.equal(typeof result, "string");
    }),
  );
});

test("extractMessage: message field has highest priority", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (msg, payload) => {
      assert.equal(extractMessage({ message: msg, payload }), msg);
    }),
  );
});

test("extractMessage: non-empty input produces non-empty output", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (msg) => {
      assert.ok(extractMessage({ message: msg }).length > 0);
    }),
  );
});
