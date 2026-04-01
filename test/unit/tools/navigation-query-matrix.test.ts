import { test, expect } from "vitest";

import { navigationQueryMatrix } from "../../fixtures/agda/navigation-query-matrix.js";

test("navigation query matrix includes goal and top-level expectations", () => {
  expect(navigationQueryMatrix.length >= 1).toBeTruthy();
  const scenario = navigationQueryMatrix[0];
  expect(scenario.topLevel?.whyInScope?.some((entry) => entry.name === "flip")).toBeTruthy();
  expect(scenario.goal?.elaborate?.some((entry) => entry.expr === "add n m")).toBeTruthy();
});
