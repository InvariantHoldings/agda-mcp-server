// MIT License — see LICENSE
//
// Property-based tests for completeness classification invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  classifyCompleteness,
  type CompletenessStatus,
} from "../../../src/agda/completeness.js";

// ── Generators ──────────────────────────────────────────────────────

const arbGoals = fc.array(fc.anything(), { minLength: 0, maxLength: 20 });
const arbInvisibleGoalCount = fc.nat({ max: 20 });

// ── Properties ──────────────────────────────────────────────────────

test("ok-complete iff success and no holes", async () => {
  await fc.assert(
    fc.property(arbGoals, arbInvisibleGoalCount, (goals, invisibleGoalCount) => {
      const result = classifyCompleteness({
        success: true,
        goals,
        invisibleGoalCount,
      });
      const expected = goals.length === 0 && invisibleGoalCount === 0;
      expect(result.classification === "ok-complete").toBe(expected);
    }),
  );
});

test("type-error iff success is false", async () => {
  await fc.assert(
    fc.property(arbGoals, arbInvisibleGoalCount, (goals, invisibleGoalCount) => {
      const result = classifyCompleteness({
        success: false,
        goals,
        invisibleGoalCount,
      });
      expect(result.classification).toBe("type-error");
    }),
  );
});

test("ok-with-holes iff success and has holes", async () => {
  await fc.assert(
    fc.property(
      fc.array(fc.anything(), { minLength: 1, maxLength: 10 }),
      arbInvisibleGoalCount,
      (goals, invisibleGoalCount) => {
        const result = classifyCompleteness({
          success: true,
          goals,
          invisibleGoalCount,
        });
        expect(result.classification).toBe("ok-with-holes");
      },
    ),
  );
});

test("hasHoles iff goalCount > 0 or invisibleGoalCount > 0", async () => {
  await fc.assert(
    fc.property(
      fc.boolean(),
      arbGoals,
      arbInvisibleGoalCount,
      (success, goals, invisibleGoalCount) => {
        const result = classifyCompleteness({ success, goals, invisibleGoalCount });
        const expected = goals.length > 0 || invisibleGoalCount > 0;
        expect(result.hasHoles).toBe(expected);
      },
    ),
  );
});

test("isComplete iff classification is ok-complete", async () => {
  await fc.assert(
    fc.property(
      fc.boolean(),
      arbGoals,
      arbInvisibleGoalCount,
      (success, goals, invisibleGoalCount) => {
        const result = classifyCompleteness({ success, goals, invisibleGoalCount });
        expect(result.isComplete).toBe(result.classification === "ok-complete");
      },
    ),
  );
});

test("goalCount equals goals array length", async () => {
  await fc.assert(
    fc.property(
      fc.boolean(),
      arbGoals,
      arbInvisibleGoalCount,
      (success, goals, invisibleGoalCount) => {
        const result = classifyCompleteness({ success, goals, invisibleGoalCount });
        expect(result.goalCount).toBe(goals.length);
      },
    ),
  );
});

test("invisibleGoalCount defaults to 0 when not provided", async () => {
  await fc.assert(
    fc.property(fc.boolean(), arbGoals, (success, goals) => {
      const result = classifyCompleteness({ success, goals });
      expect(result.invisibleGoalCount).toBe(0);
    }),
  );
});

test("classification is always one of three values", async () => {
  await fc.assert(
    fc.property(
      fc.boolean(),
      arbGoals,
      arbInvisibleGoalCount,
      (success, goals, invisibleGoalCount) => {
        const result = classifyCompleteness({ success, goals, invisibleGoalCount });
        expect(["ok-complete", "ok-with-holes", "type-error"]).toContain(
          result.classification,
        );
      },
    ),
  );
});
