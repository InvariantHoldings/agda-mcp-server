import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { libraryRegistrationMatrix } from "../../fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "../../helpers/library-registration-fixture.js";

test("library registration matrix contains both unit-only and integration scenarios", () => {
  expect(libraryRegistrationMatrix.length >= 4).toBeTruthy();
  expect(libraryRegistrationMatrix.some((scenario) => scenario.integration?.loadFile)).toBeTruthy();
  expect(libraryRegistrationMatrix.some((scenario) => !scenario.integration)).toBeTruthy();
});

test("materializeLibraryRegistrationScenario writes project and AGDA_DIR files", () => {
  const scenario = libraryRegistrationMatrix[0];
  const materialized = materializeLibraryRegistrationScenario(scenario);

  try {
    expect(existsSync(join(materialized.repoRoot, "project.agda-lib"))).toBe(true);
    expect(existsSync(join(materialized.repoRoot, "lib", "Main.agda"))).toBe(true);
    expect(existsSync(join(materialized.agdaDir, "libraries"))).toBe(true);
    expect(existsSync(join(materialized.agdaDir, "defaults"))).toBe(true);
  } finally {
    materialized.cleanup();
  }
});
