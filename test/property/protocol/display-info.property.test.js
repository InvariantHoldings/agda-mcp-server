import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeDisplayInfoEvents } from "../../../dist/protocol/responses/display-info.js";

test("decodeDisplayInfoEvents is total and only emits string text/kind pairs", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeDisplayInfoEvents(responses);
        assert.ok(Array.isArray(decoded));
        for (const event of decoded) {
          assert.ok(event.source === "top-level" || event.source === "goal-specific");
          assert.equal(typeof event.infoKind, "string");
          assert.equal(typeof event.text, "string");
          assert.ok(event.payload && typeof event.payload === "object");
        }
      },
    ),
  );
});
