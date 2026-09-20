import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { decodeLoadDisplayResponses } from "../../../src/protocol/responses/load-display.js";

const validVisibleGoal = fc.record({
  constraintObj: fc.integer({ min: 0, max: 1000 }),
  type: fc.string(),
});

const validInvisibleGoal = fc.record({
  constraintObj: fc.record({
    name: fc.string({ minLength: 1 }),
    range: fc.constant([]),
  }),
  type: fc.string(),
});

function decodeAllGoalsWarnings(payload: Record<string, unknown>) {
  return decodeLoadDisplayResponses([
    { kind: "DisplayInfo", info: { kind: "AllGoalsWarnings", ...payload } },
  ]);
}

test("canonical decoding preserves valid goal cardinality", async () => {
  await fc.assert(
    fc.property(
      fc.array(validVisibleGoal, { maxLength: 8 }),
      fc.array(validInvisibleGoal, { maxLength: 8 }),
      (visibleGoals, invisibleGoals) => {
        const decoded = decodeAllGoalsWarnings({
          visibleGoals,
          invisibleGoals,
          errors: [],
          warnings: [],
        });

        expect(decoded.protocolErrors).toEqual([]);
        expect(decoded.visibleGoals).toHaveLength(visibleGoals.length);
        expect(decoded.invisibleGoals).toHaveLength(invisibleGoals.length);
        expect(decoded.invisibleGoalCount).toBe(invisibleGoals.length);
      },
    ),
  );
});

test("canonical decoding makes every malformed goal entry observable", async () => {
  await fc.assert(
    fc.property(
      fc.array(validVisibleGoal, { maxLength: 8 }),
      fc.array(validInvisibleGoal, { maxLength: 8 }),
      (visibleGoals, invisibleGoals) => {
        const decoded = decodeAllGoalsWarnings({
          visibleGoals: [{ malformed: true }, ...visibleGoals],
          invisibleGoals: [{ malformed: true }, ...invisibleGoals],
          errors: [],
          warnings: [],
        });

        expect(decoded.protocolErrors).toEqual([
          "Malformed visible goal entry at index 0.",
          "Malformed invisible goal entry at index 0.",
        ]);
        expect(decoded.visibleGoals).toHaveLength(visibleGoals.length);
        expect(decoded.invisibleGoals).toHaveLength(invisibleGoals.length);
      },
    ),
  );
});

test("canonical decoding preserves diagnostic presence, including blank errors", async () => {
  await fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 8 }), (errors) => {
      const decoded = decodeAllGoalsWarnings({
        visibleGoals: [],
        invisibleGoals: [],
        errors,
        warnings: [],
      });

      expect(decoded.errors).toEqual(errors);
      const blankIndexes = errors.flatMap((message, index) =>
        message.trim().length === 0 ? [index] : []);
      expect(decoded.protocolErrors).toEqual(
        blankIndexes.map((index) => `Malformed error diagnostic at index ${index}.`),
      );
    }),
  );
});
