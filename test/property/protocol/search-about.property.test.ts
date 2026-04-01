import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { decodeSearchAboutResponses } from "../../../src/protocol/responses/search-about.js";

test("decodeSearchAboutResponses is total and only emits string pairs", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { requiredKeys: ["kind"] })),
      (responses) => {
        const decoded = decodeSearchAboutResponses(responses);
        expect(typeof decoded.query).toBe("string");
        expect(Array.isArray(decoded.results)).toBeTruthy();
        for (const entry of decoded.results) {
          expect(typeof entry.name).toBe("string");
          expect(typeof entry.term).toBe("string");
        }
      },
    ),
  );
});
