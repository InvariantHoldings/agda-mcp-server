import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { decodeExpressionDisplayResponses } from "../../../dist/protocol/responses/expression-display.js";

test("decodeExpressionDisplayResponses is total and only emits strings", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 6 }),
      (responses) => {
        const decoded = decodeExpressionDisplayResponses(responses);
        assert.equal(typeof decoded.normalForm, "string");
        assert.equal(typeof decoded.inferredType, "string");
      },
    ),
  );
});

test("NormalForm DisplayInfo populates normalForm", async () => {
  await fc.assert(
    fc.property(fc.string({ minLength: 1 }), (expr) => {
      const decoded = decodeExpressionDisplayResponses([
        { kind: "DisplayInfo", info: { kind: "NormalForm", expr } },
      ]);
      assert.equal(decoded.normalForm, expr);
    }),
  );
});
