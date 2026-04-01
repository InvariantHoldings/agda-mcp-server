import { test, expect } from "vitest";
import { execSync } from "node:child_process";

import { AgdaSession, typeCheckBatch } from "../../../src/agda-process.js";
import { libraryRegistrationMatrix } from "../../fixtures/agda/library-registration-matrix.js";
import { materializeLibraryRegistrationScenario } from "../../helpers/library-registration-fixture.js";

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
        expect(load.success).toBe(true);
        expect(load.errors).toEqual([]);
      } finally {
        session.destroy();
      }

      const batch = await typeCheckBatch(scenario.integration.loadFile, materialized.repoRoot);
      expect(batch.success).toBe(true);
      expect(batch.errors).toEqual([]);
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
