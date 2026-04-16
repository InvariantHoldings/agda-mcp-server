import { test, expect } from "vitest";

import { fc } from "@fast-check/vitest";

import { parseLoadResponses } from "../../../src/agda/parse-load-responses.js";

// ── Error monotonicity ───────────────────────────────────

test("adding an Error response never makes success go false→true", async () => {
  const baseResponseArb = fc.oneof(
    fc.constant({ kind: "InteractionPoints", interactionPoints: [] }),
    fc.record({
      kind: fc.constant("DisplayInfo"),
      info: fc.constant({
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      }),
    }),
    fc.constant({ kind: "Status", checked: true }),
  );

  await fc.assert(
    fc.property(fc.array(baseResponseArb, { maxLength: 5 }), (base) => {
      const withoutError = parseLoadResponses(base);
      const withError = parseLoadResponses([
        ...base,
        { kind: "DisplayInfo", info: { kind: "Error", message: "test error" } },
      ]);
      // Adding an error can only make success worse (true→false), never better
      if (!withoutError.success) {
        expect(withError.success).toBe(false);
      }
      // With an error added, success must be false
      expect(withError.success).toBe(false);
    }),
  );
});

// ── Goal-goalId consistency ──────────────────────────────

test("goalIds set equals goals.map(g => g.goalId) set", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 10 }),
      (ids) => {
        const uniqueIds = [...new Set(ids)];
        const responses = [
          { kind: "InteractionPoints", interactionPoints: uniqueIds },
          {
            kind: "DisplayInfo",
            info: {
              kind: "AllGoalsWarnings",
              visibleGoals: [],
              invisibleGoals: [],
              errors: [],
              warnings: [],
            },
          },
        ];
        const result = parseLoadResponses(responses);
        const goalIdSet = new Set(result.goalIds);
        const goalsSet = new Set(result.goals.map((g) => g.goalId));
        expect(goalIdSet).toEqual(goalsSet);
      },
    ),
  );
});

// ── No duplicate goals ───────────────────────────────────

test("goalIds has no duplicates when InteractionPoints and visibleGoals overlap", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 5 }),
      (ids) => {
        // Send the same IDs in both InteractionPoints and visibleGoals
        const responses = [
          { kind: "InteractionPoints", interactionPoints: ids },
          {
            kind: "DisplayInfo",
            info: {
              kind: "AllGoalsWarnings",
              visibleGoals: ids.map((id) => ({ constraintObj: id, type: "?" })),
              invisibleGoals: [],
              errors: [],
              warnings: [],
            },
          },
        ];
        const result = parseLoadResponses(responses);
        expect(result.goalIds.length).toBe(new Set(result.goalIds).size);
      },
    ),
  );
});

// ── Totality ─────────────────────────────────────────────

test("parseLoadResponses never throws for any array of {kind: string}", async () => {
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({ kind: fc.string() }),
        { maxLength: 10 },
      ),
      (responses) => {
        const result = parseLoadResponses(responses);
        expect(typeof result.success).toBe("boolean");
        expect(Array.isArray(result.errors)).toBeTruthy();
        expect(Array.isArray(result.warnings)).toBeTruthy();
        expect(Array.isArray(result.goals)).toBeTruthy();
        expect(Array.isArray(result.goalIds)).toBeTruthy();
        expect(typeof result.allGoalsText).toBe("string");
        expect(result.invisibleGoalCount >= 0).toBeTruthy();
      },
    ),
  );
});

// ── invisibleGoalCount ───────────────────────────────────

test("invisibleGoalCount matches invisibleGoals array length", async () => {
  // IOTCM sends invisible goals with NamedMeta constraintObj: { name: string, range: Range }
  await fc.assert(
    fc.property(
      fc.array(
        fc.record({
          constraintObj: fc.record({ name: fc.string({ minLength: 1 }) }),
          type: fc.string(),
        }),
        { maxLength: 5 },
      ),
      (invisGoals) => {
        const result = parseLoadResponses([
          { kind: "InteractionPoints", interactionPoints: [] },
          {
            kind: "DisplayInfo",
            info: {
              kind: "AllGoalsWarnings",
              visibleGoals: [],
              invisibleGoals: invisGoals,
              errors: [],
              warnings: [],
            },
          },
        ]);
        expect(result.invisibleGoalCount).toBe(invisGoals.length);
      },
    ),
  );
});
