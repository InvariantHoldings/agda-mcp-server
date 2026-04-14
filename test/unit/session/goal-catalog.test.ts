// MIT License — see LICENSE
//
// Unit tests for goal catalog domain logic.

import { describe, it, expect } from "vitest";

import {
  buildGoalCatalog,
  renderGoalCatalogText,
  type GoalCatalogInput,
} from "../../../src/session/goal-catalog.js";

function makeInput(overrides: Partial<GoalCatalogInput> = {}): GoalCatalogInput {
  return {
    goals: [],
    invisibleGoalCount: 0,
    ...overrides,
  };
}

describe("buildGoalCatalog", () => {
  it("returns empty catalog for no goals", () => {
    const catalog = buildGoalCatalog(makeInput());
    expect(catalog.goalCount).toBe(0);
    expect(catalog.hasHoles).toBe(false);
    expect(catalog.goals).toHaveLength(0);
  });

  it("detects holes from invisible goals alone", () => {
    const catalog = buildGoalCatalog(makeInput({ invisibleGoalCount: 2 }));
    expect(catalog.hasHoles).toBe(true);
    expect(catalog.goalCount).toBe(0);
    expect(catalog.invisibleGoalCount).toBe(2);
  });

  it("builds catalog entries for goals with context", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "Nat", context: ["n : Nat", "m : Nat"] },
        { goalId: 1, type: "Bool", context: [] },
      ],
    }));

    expect(catalog.goalCount).toBe(2);
    expect(catalog.hasHoles).toBe(true);
    expect(catalog.goals[0].goalId).toBe(0);
    expect(catalog.goals[0].type).toBe("Nat");
    expect(catalog.goals[0].context).toHaveLength(2);
    expect(catalog.goals[0].context[0].name).toBe("n");
    expect(catalog.goals[0].context[0].type).toBe("Nat");
    expect(catalog.goals[0].splittableVariables).toContain("n");
    expect(catalog.goals[0].splittableVariables).toContain("m");
  });

  it("sorts goals by goalId", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 3, type: "Nat", context: [] },
        { goalId: 1, type: "Bool", context: [] },
        { goalId: 2, type: "Set", context: [] },
      ],
    }));

    expect(catalog.goals.map((g) => g.goalId)).toEqual([1, 2, 3]);
  });

  it("parses implicit context entries", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "A", context: ["{A : Set}", "x : A"] },
      ],
    }));

    expect(catalog.goals[0].context[0].isImplicit).toBe(true);
    expect(catalog.goals[0].context[0].name).toBe("A");
    expect(catalog.goals[0].context[1].isImplicit).toBe(false);
    // Implicit vars should NOT be splittable
    expect(catalog.goals[0].splittableVariables).toEqual(["x"]);
  });

  it("derives suggestions for equality goals", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "x ≡ x", context: ["x : Nat"] },
      ],
    }));

    const actions = catalog.goals[0].suggestions.map((s) => s.action);
    expect(actions).toContain("give");
    expect(actions).toContain("auto");
  });

  it("derives suggestions for function goals", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "Nat → Bool", context: [] },
      ],
    }));

    const actions = catalog.goals[0].suggestions.map((s) => s.action);
    expect(actions).toContain("refine");
    expect(actions).toContain("intro");
  });

  it("always includes auto as fallback", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "SomeType", context: [] },
      ],
    }));

    const actions = catalog.goals[0].suggestions.map((s) => s.action);
    expect(actions).toContain("auto");
  });
});

describe("renderGoalCatalogText", () => {
  it("renders empty catalog", () => {
    const catalog = buildGoalCatalog(makeInput());
    const text = renderGoalCatalogText(catalog);
    expect(text).toContain("No visible goals");
    expect(text).toContain("Goals:** 0");
  });

  it("renders catalog with goals", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [
        { goalId: 0, type: "Nat", context: ["n : Nat"] },
      ],
    }));
    const text = renderGoalCatalogText(catalog);
    expect(text).toContain("Goal ?0");
    expect(text).toContain("Nat");
    expect(text).toContain("Splittable");
    expect(text).toContain("`n`");
  });

  it("renders invisible goal count", () => {
    const catalog = buildGoalCatalog(makeInput({
      goals: [{ goalId: 0, type: "Nat", context: [] }],
      invisibleGoalCount: 3,
    }));
    const text = renderGoalCatalogText(catalog);
    expect(text).toContain("3 invisible");
  });
});
