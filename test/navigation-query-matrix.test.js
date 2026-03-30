import test from "node:test";
import assert from "node:assert/strict";

import { navigationQueryMatrix } from "./fixtures/agda/navigation-query-matrix.js";

test("navigation query matrix includes goal and top-level expectations", () => {
  assert.ok(navigationQueryMatrix.length >= 1);
  const scenario = navigationQueryMatrix[0];
  assert.ok(scenario.topLevel?.whyInScope?.some((entry) => entry.name === "flip"));
  assert.ok(scenario.goal?.elaborate?.some((entry) => entry.expr === "add n m"));
});
