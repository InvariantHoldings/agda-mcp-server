import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import {
  createLibraryRegistration,
  parseAgdaLibraryName,
} from "../../../dist/agda/library-registration.js";

test("parseAgdaLibraryName is total and only returns string or null", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (contents) => {
      const result = parseAgdaLibraryName(contents);
      assert.ok(result === null || typeof result === "string");
    }),
  );
});

test("parseAgdaLibraryName returns the first declared name after comments and blanks", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/u),
      fc.array(fc.constantFrom("-- comment", "", "   ")),
      async (name, prefixLines) => {
        const contents = [...prefixLines, `name: ${name}`, "include: src"].join("\n");
        assert.equal(parseAgdaLibraryName(contents), name);
      },
    ),
  );
});

test("parseAgdaLibraryName strips inline -- comments and returns the trimmed identifier", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/u),
      fc.string(),
      async (name, commentSuffix) => {
        const contents = `name: ${name} --${commentSuffix}\ninclude: src\n`;
        assert.equal(parseAgdaLibraryName(contents), name);
      },
    ),
  );
});

test("createLibraryRegistration reuses stable AGDA_DIR when set, creates temp otherwise", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (useStable) => {
      const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-prop-repo-"));
      writeFileSync(
        join(repoRoot, "project.agda-lib"),
        "name: project\ninclude: src\n",
        "utf8",
      );

      const previousAgdaDir = process.env.AGDA_DIR;
      let stableDir;

      try {
        if (useStable) {
          stableDir = mkdtempSync(join(tmpdir(), "agda-mcp-prop-stable-"));
          writeFileSync(join(stableDir, "libraries"), "", "utf8");
          writeFileSync(join(stableDir, "defaults"), "", "utf8");
          process.env.AGDA_DIR = stableDir;
        } else {
          delete process.env.AGDA_DIR;
        }

        const registration = createLibraryRegistration(repoRoot);

        if (useStable) {
          // Stable path: returned dir IS the dir we set
          assert.equal(registration.agdaDir, stableDir);
          registration.cleanup();
          assert.ok(existsSync(stableDir), "stable dir must survive cleanup");
        } else {
          // Temp path: returned dir is a fresh temp dir
          assert.ok(existsSync(registration.agdaDir));
          const tempDir = registration.agdaDir;
          registration.cleanup();
          assert.ok(!existsSync(tempDir), "temp dir must be removed by cleanup");
        }
      } finally {
        if (previousAgdaDir === undefined) {
          delete process.env.AGDA_DIR;
        } else {
          process.env.AGDA_DIR = previousAgdaDir;
        }
        rmSync(repoRoot, { recursive: true, force: true });
        if (stableDir) {
          rmSync(stableDir, { recursive: true, force: true });
        }
      }
    }),
    { numRuns: 10 },
  );
});
