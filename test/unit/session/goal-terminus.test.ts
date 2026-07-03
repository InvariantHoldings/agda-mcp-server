import { test, expect } from "vitest";

import { GoalTerminusTracker } from "../../../src/session/goal-terminus.js";

test("reached() requires both InteractionPoints and AllGoalsWarnings", () => {
  const t = new GoalTerminusTracker();
  expect(t.reached()).toBe(false);

  t.record({ kind: "InteractionPoints", interactionPoints: [] });
  expect(t.reached()).toBe(false); // AllGoalsWarnings not yet seen

  t.record({
    kind: "DisplayInfo",
    info: { kind: "AllGoalsWarnings", visibleGoals: [], invisibleGoals: [], errors: [], warnings: [] },
  } as never);
  expect(t.reached()).toBe(true);
});

test("reached() short-circuits on a DisplayInfo Error", () => {
  const t = new GoalTerminusTracker();
  t.record({ kind: "DisplayInfo", info: { kind: "Error", message: "boom" } } as never);
  expect(t.reached()).toBe(true);
});

test("progress/highlighting responses are never a terminus", () => {
  const t = new GoalTerminusTracker();
  for (const kind of ["Status", "RunningInfo", "HighlightingInfo", "ClearHighlighting", "ClearRunningInfo"]) {
    t.record({ kind } as never);
  }
  expect(t.reached()).toBe(false);
});

test("reset() clears observed terminus state", () => {
  const t = new GoalTerminusTracker();
  t.record({ kind: "InteractionPoints", interactionPoints: [0] });
  t.record({
    kind: "DisplayInfo",
    info: { kind: "AllGoalsWarnings", visibleGoals: [], invisibleGoals: [], errors: [], warnings: [] },
  } as never);
  expect(t.reached()).toBe(true);
  t.reset();
  expect(t.reached()).toBe(false);
});
