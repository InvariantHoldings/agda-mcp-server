import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import {
  decodeInteractionPointIds,
  decodeStderrOutputs,
} from "../../../dist/protocol/responses/process-output.js";

test("decodeInteractionPointIds is total and returns unique numbers", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeInteractionPointIds(responses);
        assert.ok(Array.isArray(decoded));
        assert.ok(decoded.every((value) => typeof value === "number"));
        assert.equal(decoded.length, new Set(decoded).size);
      },
    ),
  );
});

test("decodeStderrOutputs is total and returns strings", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeStderrOutputs(responses);
        assert.ok(Array.isArray(decoded));
        assert.ok(decoded.every((value) => typeof value === "string"));
      },
    ),
  );
});
