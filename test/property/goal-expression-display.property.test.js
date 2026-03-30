import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeGoalExpressionDisplayResponses } from "../../dist/protocol/responses/goal-expression-display.js";

test("decodeGoalExpressionDisplayResponses is total and returns strings plus context array", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 6 }),
      (responses) => {
        const decoded = decodeGoalExpressionDisplayResponses(responses);
        assert.equal(typeof decoded.goalType, "string");
        assert.ok(Array.isArray(decoded.context));
        assert.equal(typeof decoded.inferredType, "string");
        assert.equal(typeof decoded.checkedExpr, "string");
      },
    ),
  );
});
