import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeSearchAboutResponses } from "../../dist/protocol/responses/search-about.js";

test("decodeSearchAboutResponses is total and only emits string pairs", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { requiredKeys: ["kind"] })),
      (responses) => {
        const decoded = decodeSearchAboutResponses(responses);
        assert.equal(typeof decoded.query, "string");
        assert.ok(Array.isArray(decoded.results));
        for (const entry of decoded.results) {
          assert.equal(typeof entry.name, "string");
          assert.equal(typeof entry.term, "string");
        }
      },
    ),
  );
});
