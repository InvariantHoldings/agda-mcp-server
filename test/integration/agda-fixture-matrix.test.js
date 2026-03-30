import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { AgdaSession, typeCheckBatch } from "../../dist/agda-process.js";
import { fixtureMatrix } from "../fixtures/agda/fixture-matrix.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/agda");

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

async function withSession(run) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await run(session);
  } finally {
    session.destroy();
  }
}

test("fixture matrix entries reference existing files", () => {
  for (const fixture of fixtureMatrix) {
    assert.equal(
      existsSync(resolve(FIXTURES, fixture.name)),
      true,
      `fixture missing on disk: ${fixture.name}`,
    );
  }
});

for (const fixture of fixtureMatrix) {
  it(`${fixture.name}: load and batch typecheck match matrix expectations`, async () => {
    await withSession(async (session) => {
      const load = await session.load(fixture.name);
      const batch = await typeCheckBatch(fixture.name, FIXTURES);

      assert.equal(load.success, fixture.expectedSuccess);
      assert.equal(load.classification, fixture.expectedClassification);
      assert.ok(
        load.goalCount >= fixture.minGoalCount,
        `expected >=${fixture.minGoalCount} goals for ${fixture.name}, got ${load.goalCount}`,
      );

      assert.equal(batch.success, fixture.expectedSuccess);
      assert.equal(batch.classification, fixture.expectedClassification);
      assert.ok(
        batch.goalCount >= fixture.minGoalCount,
        `expected >=${fixture.minGoalCount} batch goals for ${fixture.name}, got ${batch.goalCount}`,
      );

      if (load.goalCount > 0) {
        const info = await session.goal.typeContext(load.goals[0].goalId);
        assert.ok(info.type.length > 0, `expected non-empty goal type for ${fixture.name}`);
      }
    });
  });
}

test.todo("agda_search_about returns non-empty results for SearchAboutTargets.agda (#7)");
