import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { parseAgdaStdoutLine } from "../../../dist/session/stdout-line.js";

test("parseAgdaStdoutLine preserves JSON payloads after known prompt prefixes", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("JSON> ", "Agda2> "),
      fc.string().filter((value) => !value.includes("\n")),
      async (prefix, payload) => {
        const line = `${prefix}{"payload":${JSON.stringify(payload)}}`;
        const parsed = parseAgdaStdoutLine(line);
        assert.equal(parsed.jsonText, `{"payload":${JSON.stringify(payload)}}`);
      },
    ),
  );
});

test("parseAgdaStdoutLine never throws for arbitrary single-line input", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string().filter((value) => !value.includes("\n")),
      async (line) => {
        assert.doesNotThrow(() => parseAgdaStdoutLine(line));
      },
    ),
  );
});
