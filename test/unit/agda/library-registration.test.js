import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  createLibraryRegistration,
  parseAgdaLibraryName,
} from "../../../dist/agda/library-registration.js";
import { libraryRegistrationMatrix } from "../../fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "../../helpers/library-registration-fixture.js";

test("parseAgdaLibraryName extracts the declared library name", () => {
  const contents = [
    "-- comment",
    "",
    "name: example-lib",
    "include: src",
  ].join("\n");

  assert.equal(parseAgdaLibraryName(contents), "example-lib");
});

test("parseAgdaLibraryName strips inline -- comments from the name", () => {
  const contents = "name: example-lib --this is a comment\ninclude: src\n";
  assert.equal(parseAgdaLibraryName(contents), "example-lib");
});

test("parseAgdaLibraryName strips inline -- comments with no preceding space", () => {
  const contents = "name: my-lib--attached comment\ninclude: src\n";
  assert.equal(parseAgdaLibraryName(contents), "my-lib");
});

test("parseAgdaLibraryName returns null when name is only a comment", () => {
  const contents = "name: --just a comment\ninclude: src\n";
  assert.equal(parseAgdaLibraryName(contents), null);
});

for (const scenario of libraryRegistrationMatrix) {
  test(`createLibraryRegistration honors matrix scenario: ${scenario.name}`, () => {
    const materialized = materializeLibraryRegistrationScenario(scenario);
    const previousAgdaDir = process.env.AGDA_DIR;

    try {
      process.env.AGDA_DIR = materialized.agdaDir;

      const registration = createLibraryRegistration(materialized.repoRoot);
      try {
        assert.deepEqual(registration.agdaArgs, scenario.expectedAgdaArgs);

        const libraryText = readFileSync(join(registration.agdaDir, "libraries"), "utf8");
        const defaultsText = readFileSync(join(registration.agdaDir, "defaults"), "utf8");

        const libraries = libraryText.trim().length === 0
          ? []
          : libraryText.trim().split("\n").map((entry) => basename(entry));
        const defaults = defaultsText.trim().length === 0
          ? []
          : defaultsText.trim().split("\n");

        assert.deepEqual(libraries, scenario.expectedLibraryBasenames);
        assert.deepEqual(defaults, scenario.expectedDefaults);
      } finally {
        registration.cleanup();
      }
    } finally {
      if (previousAgdaDir === undefined) {
        delete process.env.AGDA_DIR;
      } else {
        process.env.AGDA_DIR = previousAgdaDir;
      }
      materialized.cleanup();
    }
  });
}
