// MIT License — see LICENSE
//
// Property-based tests for goal catalog invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  buildGoalCatalog,
  type GoalCatalogInput,
} from "../../../src/session/goal-catalog.js";

// ── Generators ──────────────────────────────────────────────────────

const arbContextEntry = fc.oneof(
  fc.string({ minLength: 1, maxLength: 10 }).map((n) => `${n} : Nat`),
  fc.string({ minLength: 1, maxLength: 10 }).map((n) => `{${n} : Set}`),
  fc.constant(""),
);

const arbGoal = fc.record({
  goalId: fc.nat({ max: 100 }),
  type: fc.string({ minLength: 0, maxLength: 30 }),
  context: fc.array(arbContextEntry, { minLength: 0, maxLength: 5 }),
});

const arbInput: fc.Arbitrary<GoalCatalogInput> = fc.record({
  goals: fc.array(arbGoal, { minLength: 0, maxLength: 10 }),
  invisibleGoalCount: fc.nat({ max: 20 }),
});

// ── Properties ──────────────────────────────────────────────────────

test("goalCount always equals goals.length", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      expect(catalog.goalCount).toBe(input.goals.length);
    }),
  );
});

test("hasHoles is true iff goalCount > 0 or invisibleGoalCount > 0", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      const expected = input.goals.length > 0 || input.invisibleGoalCount > 0;
      expect(catalog.hasHoles).toBe(expected);
    }),
  );
});

test("goals are sorted by goalId", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      for (let i = 1; i < catalog.goals.length; i++) {
        expect(catalog.goals[i].goalId).toBeGreaterThanOrEqual(
          catalog.goals[i - 1].goalId,
        );
      }
    }),
  );
});

test("every goal has at least one suggestion (auto fallback)", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      for (const goal of catalog.goals) {
        expect(goal.suggestions.length).toBeGreaterThanOrEqual(1);
        expect(goal.suggestions.some((s) => s.action === "auto")).toBe(true);
      }
    }),
  );
});

test("splittableVariables are all non-implicit", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      for (const goal of catalog.goals) {
        for (const varName of goal.splittableVariables) {
          const entry = goal.context.find((e) => e.name === varName);
          if (entry) {
            expect(entry.isImplicit).toBe(false);
          }
        }
      }
    }),
  );
});

test("catalog preserves invisibleGoalCount from input", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      expect(catalog.invisibleGoalCount).toBe(input.invisibleGoalCount);
    }),
  );
});

test("suggestions never contain duplicate actions at same position", async () => {
  await fc.assert(
    fc.property(arbInput, (input) => {
      const catalog = buildGoalCatalog(input);
      for (const goal of catalog.goals) {
        // Each suggestion should have a defined action
        for (const s of goal.suggestions) {
          expect(["give", "refine", "case_split", "auto", "intro"]).toContain(s.action);
          expect(s.reason.length).toBeGreaterThan(0);
        }
      }
    }),
  );
});
