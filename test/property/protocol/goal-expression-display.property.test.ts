import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { decodeGoalExpressionDisplayResponses } from "../../../src/protocol/responses/goal-expression-display.js";

test("decodeGoalExpressionDisplayResponses is total and returns strings plus context array", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.record({ kind: fc.string() }), { maxLength: 6 }),
      (responses) => {
        const decoded = decodeGoalExpressionDisplayResponses(responses);
        expect(typeof decoded.goalType).toBe("string");
        expect(Array.isArray(decoded.context)).toBeTruthy();
        expect(typeof decoded.inferredType).toBe("string");
        expect(typeof decoded.checkedExpr).toBe("string");
      },
    ),
  );
});
