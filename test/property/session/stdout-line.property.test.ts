import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { parseAgdaStdoutLine } from "../../../src/session/stdout-line.js";

test("parseAgdaStdoutLine preserves JSON payloads after known prompt prefixes", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("JSON> ", "Agda2> "),
      fc.string().filter((value) => !value.includes("\n")),
      async (prefix, payload) => {
        const line = `${prefix}{"payload":${JSON.stringify(payload)}}`;
        const parsed = parseAgdaStdoutLine(line);
        expect(parsed.jsonText).toBe(`{"payload":${JSON.stringify(payload)}}`);
      },
    ),
  );
});

test("parseAgdaStdoutLine never throws for arbitrary single-line input", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string().filter((value) => !value.includes("\n")),
      async (line) => {
        expect(() => parseAgdaStdoutLine(line)).not.toThrow();
      },
    ),
  );
});
