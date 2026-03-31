import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeLoadDisplayResponses } from "../../../dist/protocol/responses/load-display.js";

test("decodeLoadDisplayResponses is total and returns structured arrays", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }, { withDeletedKeys: true })),
      (responses) => {
        const decoded = decodeLoadDisplayResponses(responses);
        assert.equal(typeof decoded.text, "string");
        assert.ok(Array.isArray(decoded.visibleGoals));
        assert.ok(Array.isArray(decoded.warnings));
        assert.ok(Array.isArray(decoded.errors));
        assert.ok(decoded.visibleGoals.every((goal) => typeof goal.goalId === "number"));
        assert.ok(decoded.visibleGoals.every((goal) => typeof goal.type === "string"));
      },
    ),
  );
});
