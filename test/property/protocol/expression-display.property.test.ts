import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { decodeExpressionDisplayResponses } from "../../../src/protocol/responses/expression-display.js";

test("decodeExpressionDisplayResponses is total and only emits strings", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 6 }),
      (responses) => {
        const decoded = decodeExpressionDisplayResponses(responses);
        expect(typeof decoded.normalForm).toBe("string");
        expect(typeof decoded.inferredType).toBe("string");
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
      expect(decoded.normalForm).toBe(expr);
    }),
  );
});
