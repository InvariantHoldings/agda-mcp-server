import { test, expect } from "vitest";

import { fixtureMatrix } from "../../fixtures/agda/fixture-matrix.js";

test("fixture matrix validates search expectations for search fixtures", () => {
  const targets = fixtureMatrix.find((fixture) => fixture.name === "SearchAboutTargets.agda");
  expect(targets).toBeTruthy();
  expect(Array.isArray(targets.searchQueries)).toBeTruthy();
  expect(targets.searchQueries.some((query) => query.query === "Maybe")).toBeTruthy();

  const nested = fixtureMatrix.find((fixture) => fixture.name === "SearchAboutNestedModules.agda");
  expect(nested).toBeTruthy();
  expect(Array.isArray(nested.searchQueries)).toBeTruthy();
  expect(nested.searchQueries.some((query) => query.expectedNames.includes("flip"))).toBeTruthy();
});
