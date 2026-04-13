import { describe, test, expect } from "vitest";

import { diffGoalIds } from "../../../src/session/reload-and-diagnose.js";

describe("diffGoalIds", () => {
  test("empty before and after", () => {
    expect(diffGoalIds([], [])).toEqual({
      solved: [], introduced: [], remaining: [],
    });
  });

  test("all goals solved", () => {
    expect(diffGoalIds([0, 1, 2], [])).toEqual({
      solved: [0, 1, 2], introduced: [], remaining: [],
    });
  });

  test("no change", () => {
    expect(diffGoalIds([0, 1, 2], [0, 1, 2])).toEqual({
      solved: [], introduced: [], remaining: [0, 1, 2],
    });
  });

  test("one solved, others remain", () => {
    expect(diffGoalIds([0, 1, 2], [1, 2])).toEqual({
      solved: [0], introduced: [], remaining: [1, 2],
    });
  });

  test("refine: one solved, subgoals introduced", () => {
    // Original goal 0 resolved by applying a 2-arg function, creating
    // two new subgoals. Agda renumbers, so new goals have fresh IDs.
    expect(diffGoalIds([0, 1], [2, 3, 1])).toEqual({
      solved: [0], introduced: [2, 3], remaining: [1],
    });
  });

  test("case split: one solved, multiple clauses introduced", () => {
    // Case split on goal 0 with 3 cases creates 3 new holes.
    expect(diffGoalIds([0, 1, 2], [3, 4, 5, 1, 2])).toEqual({
      solved: [0], introduced: [3, 4, 5], remaining: [1, 2],
    });
  });

  test("completely new goal set (full renumber)", () => {
    // Reload after major edit — Agda renumbered everything.
    expect(diffGoalIds([0, 1, 2], [10, 11, 12])).toEqual({
      solved: [0, 1, 2], introduced: [10, 11, 12], remaining: [],
    });
  });

  test("preserves order from input arrays", () => {
    const diff = diffGoalIds([5, 3, 1, 7], [3, 1, 9]);
    expect(diff.solved).toEqual([5, 7]); // order from "before"
    expect(diff.introduced).toEqual([9]); // order from "after"
    expect(diff.remaining).toEqual([3, 1]); // order from "before"
  });

  test("handles duplicate IDs defensively", () => {
    // Duplicate IDs in either list shouldn't break the diff.
    // Agda never produces duplicates, but a caller bug shouldn't crash.
    const diff = diffGoalIds([0, 0, 1], [0, 2]);
    expect(diff.solved).toEqual([1]);
    expect(diff.introduced).toEqual([2]);
    // remaining preserves order + duplication from input
    expect(diff.remaining).toEqual([0, 0]);
  });
});
