import { test, expect } from "vitest";

import { renderLoadLikeText } from "../../../src/session/tool-presentation.js";

test("renderLoadLikeText includes profiling section when profiling data is provided", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Test.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
    profiling: "Total: 1.23s (type-checking)",
  });

  expect(text).toContain("### Profiling");
  expect(text).toContain("Total: 1.23s (type-checking)");
});

test("renderLoadLikeText omits profiling section when profiling is null", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Test.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
    profiling: null,
  });

  expect(text).not.toContain("### Profiling");
});

test("renderLoadLikeText omits profiling section when profiling is undefined", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Test.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
  });

  expect(text).not.toContain("### Profiling");
});

test("renderLoadLikeText includes elapsed time when elapsedMs is provided", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Test.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
    elapsedMs: 1234,
  });

  expect(text).toContain("**Elapsed:** 1234ms");
});

test("renderLoadLikeText omits elapsed time when elapsedMs is undefined", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Test.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
  });

  expect(text).not.toContain("**Elapsed:**");
});

test("renderLoadLikeText shows both profiling and elapsed when both provided", () => {
  const text = renderLoadLikeText({
    heading: "Type-check",
    file: "Big.agda",
    success: true,
    classification: "ok-complete",
    goalIds: [],
    goalCount: 0,
    invisibleGoalCount: 0,
    errors: [],
    warnings: [],
    profiling: "Module A: 0.5s\nModule B: 1.0s",
    elapsedMs: 1500,
  });

  expect(text).toContain("**Elapsed:** 1500ms");
  expect(text).toContain("### Profiling");
  expect(text).toContain("Module A: 0.5s\nModule B: 1.0s");
});

test("renderLoadLikeText profiling section appears after warnings and before goals", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "WithGoals.agda",
    success: true,
    classification: "ok-with-holes",
    goalIds: [0, 1],
    goalCount: 2,
    invisibleGoalCount: 0,
    errors: [],
    warnings: ["some warning"],
    profiling: "Profiling info here",
  });

  const profilingIdx = text.indexOf("### Profiling");
  const goalIdx = text.indexOf("### Goal IDs");
  const warningIdx = text.indexOf("### Warnings");

  expect(profilingIdx).toBeGreaterThan(warningIdx);
  expect(goalIdx).toBeGreaterThan(profilingIdx);
});
