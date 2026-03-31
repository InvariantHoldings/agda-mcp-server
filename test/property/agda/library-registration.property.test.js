import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { parseAgdaLibraryName } from "../../../dist/agda/library-registration.js";

test("parseAgdaLibraryName is total and only returns string or null", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (contents) => {
      const result = parseAgdaLibraryName(contents);
      assert.ok(result === null || typeof result === "string");
    }),
  );
});

test("parseAgdaLibraryName returns the first declared name after comments and blanks", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/[A-Za-z][A-Za-z0-9-]*/u),
      fc.array(fc.constantFrom("-- comment", "", "   ")),
      async (name, prefixLines) => {
        const contents = [...prefixLines, `name: ${name}`, "include: src"].join("\n");
        assert.equal(parseAgdaLibraryName(contents), name.trim());
      },
    ),
  );
});
