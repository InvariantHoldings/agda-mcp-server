import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  createLibraryRegistration,
  parseAgdaLibraryName,
} from "../../../src/agda/library-registration.js";
import { libraryRegistrationMatrix, type LibraryRegistrationScenario } from "../../fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "../../helpers/library-registration-fixture.js";

test("parseAgdaLibraryName extracts the declared library name", () => {
  const contents = [
    "-- comment",
    "",
    "name: example-lib",
    "include: src",
  ].join("\n");

  expect(parseAgdaLibraryName(contents)).toBe("example-lib");
});

test("parseAgdaLibraryName strips inline -- comments from the name", () => {
  const contents = "name: example-lib --this is a comment\ninclude: src\n";
  expect(parseAgdaLibraryName(contents)).toBe("example-lib");
});

test("parseAgdaLibraryName strips inline -- comments with no preceding space", () => {
  const contents = "name: my-lib--attached comment\ninclude: src\n";
  expect(parseAgdaLibraryName(contents)).toBe("my-lib");
});

test("parseAgdaLibraryName returns null when name is only a comment", () => {
  const contents = "name: --just a comment\ninclude: src\n";
  expect(parseAgdaLibraryName(contents)).toBe(null);
});

for (const scenario of libraryRegistrationMatrix) {
  test(`createLibraryRegistration honors matrix scenario: ${scenario.name}`, () => {
    const materialized = materializeLibraryRegistrationScenario(scenario);
    const previousAgdaDir = process.env.AGDA_DIR;

    try {
      process.env.AGDA_DIR = materialized.agdaDir;

      const registration = createLibraryRegistration(materialized.repoRoot);
      try {
        expect(registration.agdaArgs).toEqual(scenario.expectedAgdaArgs);

        const libraryText = readFileSync(join(registration.agdaDir, "libraries"), "utf8");
        const defaultsText = readFileSync(join(registration.agdaDir, "defaults"), "utf8");

        const libraries = libraryText.trim().length === 0
          ? []
          : libraryText.trim().split("\n").map((entry) => basename(entry));
        const defaults = defaultsText.trim().length === 0
          ? []
          : defaultsText.trim().split("\n");

        expect(libraries).toEqual(scenario.expectedLibraryBasenames);
        expect(defaults).toEqual(scenario.expectedDefaults);
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

test("stable AGDA_DIR: reuses the directory and cleanup is a no-op", () => {
  const scenario = libraryRegistrationMatrix.find(
    (s) => s.name === "stable-agda-dir-reuses-existing-directory",
  );
  expect(scenario).toBeTruthy();

  const materialized = materializeLibraryRegistrationScenario(scenario!);
  const previousAgdaDir = process.env.AGDA_DIR;

  try {
    process.env.AGDA_DIR = materialized.agdaDir;

    const registration = createLibraryRegistration(materialized.repoRoot);

    // The returned agdaDir must be the same directory we set (not a temp dir)
    expect(registration.agdaDir).toBe(materialized.agdaDir);

    // Cleanup must not delete the stable directory
    registration.cleanup();
    expect(existsSync(materialized.agdaDir)).toBeTruthy();
    expect(
      existsSync(join(materialized.agdaDir, "libraries")),
    ).toBeTruthy();
  } finally {
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }
    materialized.cleanup();
  }
});

test("unset AGDA_DIR: creates a temp dir that cleanup() removes", () => {
  const scenario = libraryRegistrationMatrix.find(
    (s) => s.name === "multiple-project-libraries-are-sorted-by-name",
  );
  expect(scenario).toBeTruthy();

  const materialized = materializeLibraryRegistrationScenario(scenario!);
  const previousAgdaDir = process.env.AGDA_DIR;

  try {
    // Unset AGDA_DIR so the fallback temp-dir path is taken
    delete process.env.AGDA_DIR;

    const registration = createLibraryRegistration(materialized.repoRoot);
    const createdDir = registration.agdaDir;

    expect(existsSync(createdDir)).toBeTruthy();
    expect(createdDir !== materialized.agdaDir).toBeTruthy();

    registration.cleanup();
    expect(!existsSync(createdDir)).toBeTruthy();
  } finally {
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }
    materialized.cleanup();
  }
});
