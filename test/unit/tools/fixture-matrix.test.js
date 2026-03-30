import test from "node:test";
import assert from "node:assert/strict";

import { fixtureMatrix } from "../../fixtures/agda/fixture-matrix.js";

test("fixture matrix validates search expectations for search fixtures", () => {
  const targets = fixtureMatrix.find((fixture) => fixture.name === "SearchAboutTargets.agda");
  assert.ok(targets);
  assert.ok(Array.isArray(targets.searchQueries));
  assert.ok(targets.searchQueries.some((query) => query.query === "Maybe"));

  const nested = fixtureMatrix.find((fixture) => fixture.name === "SearchAboutNestedModules.agda");
  assert.ok(nested);
  assert.ok(Array.isArray(nested.searchQueries));
  assert.ok(nested.searchQueries.some((query) => query.expectedNames.includes("flip")));
});
