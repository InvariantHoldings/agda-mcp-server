import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createLibraryRegistration,
  parseAgdaLibraryName,
} from "../dist/agda/library-registration.js";

test("parseAgdaLibraryName extracts the declared library name", () => {
  const contents = [
    "-- comment",
    "",
    "name: example-lib",
    "include: src",
  ].join("\n");

  assert.equal(parseAgdaLibraryName(contents), "example-lib");
});

test("createLibraryRegistration filters broken global config and adds project libraries", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-repo-"));
  const agdaDir = mkdtempSync(join(tmpdir(), "agda-mcp-app-"));
  const previousAgdaDir = process.env.AGDA_DIR;

  try {
    const validLibrary = join(agdaDir, "standard-library.agda-lib");
    const missingLibrary = join(agdaDir, "missing.agda-lib");
    const projectLibrary = join(repoRoot, "project.agda-lib");

    writeFileSync(validLibrary, "name: standard-library\ninclude: src\n", "utf8");
    writeFileSync(projectLibrary, "name: project\ninclude: .\n", "utf8");
    writeFileSync(join(agdaDir, "libraries"), `${validLibrary}\n${missingLibrary}\n`, "utf8");
    writeFileSync(join(agdaDir, "defaults"), "standard-library\nmissing\n", "utf8");

    process.env.AGDA_DIR = agdaDir;

    const registration = createLibraryRegistration(repoRoot);
    try {
      assert.deepEqual(registration.agdaArgs, ["-l", "project"]);

      const libraries = readFileSync(join(registration.agdaDir, "libraries"), "utf8")
        .trim()
        .split("\n");
      const defaults = readFileSync(join(registration.agdaDir, "defaults"), "utf8")
        .trim()
        .split("\n");

      assert.deepEqual(libraries, [validLibrary, projectLibrary]);
      assert.deepEqual(defaults, ["standard-library"]);
    } finally {
      registration.cleanup();
    }
  } finally {
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(agdaDir, { recursive: true, force: true });
  }
});
