import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { AgdaSession, typeCheckBatch } from "../../dist/agda-process.js";
import { libraryRegistrationMatrix } from "../fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "../helpers/library-registration-fixture.js";

let agdaAvailable = false;
try {
  execSync("agda --version", { stdio: "pipe" });
  agdaAvailable = true;
} catch {
  // Agda not in PATH
}

const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1"
  ? test
  : test.skip;

for (const scenario of libraryRegistrationMatrix.filter((entry) => entry.integration)) {
  it(`library registration integration: ${scenario.name}`, async () => {
    const materialized = materializeLibraryRegistrationScenario(scenario);
    const previousAgdaDir = process.env.AGDA_DIR;

    try {
      process.env.AGDA_DIR = materialized.agdaDir;

      const session = new AgdaSession(materialized.repoRoot);
      try {
        const load = await session.load(scenario.integration.loadFile);
        assert.equal(load.success, true, load.errors.join("\n"));
        assert.deepEqual(load.errors, []);
      } finally {
        session.destroy();
      }

      const batch = await typeCheckBatch(scenario.integration.loadFile, materialized.repoRoot);
      assert.equal(batch.success, true, batch.errors.join("\n"));
      assert.deepEqual(batch.errors, []);
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
