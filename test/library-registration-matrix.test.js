import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { libraryRegistrationMatrix } from "./fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "./helpers/library-registration-fixture.js";

test("library registration matrix contains both unit-only and integration scenarios", () => {
  assert.ok(libraryRegistrationMatrix.length >= 4);
  assert.ok(libraryRegistrationMatrix.some((scenario) => scenario.integration?.loadFile));
  assert.ok(libraryRegistrationMatrix.some((scenario) => !scenario.integration));
});

test("materializeLibraryRegistrationScenario writes project and AGDA_DIR files", () => {
  const scenario = libraryRegistrationMatrix[0];
  const materialized = materializeLibraryRegistrationScenario(scenario);

  try {
    assert.equal(existsSync(join(materialized.repoRoot, "project.agda-lib")), true);
    assert.equal(existsSync(join(materialized.repoRoot, "lib", "Main.agda")), true);
    assert.equal(existsSync(join(materialized.agdaDir, "libraries")), true);
    assert.equal(existsSync(join(materialized.agdaDir, "defaults")), true);
  } finally {
    materialized.cleanup();
  }
});
