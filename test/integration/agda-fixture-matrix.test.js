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

function selectedPhases() {
  const rawPhases = process.env.AGDA_FIXTURE_PHASES?.trim();
  if (!rawPhases) {
    return new Set(["load", "strict", "batch", "goal", "search"]);
  }

  return new Set(
    rawPhases
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function selectedFixtures() {
  const rawFilter = process.env.AGDA_FIXTURE_FILTER?.trim();
  if (!rawFilter) {
    return fixtureMatrix;
  }

  const parts = rawFilter
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return fixtureMatrix.filter((fixture) =>
    parts.some((part) => fixture.name.includes(part)),
  );
}

async function withSession(run) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await run(session);
  } finally {
    session.destroy();
  }
}

async function timedStep(t, label, run) {
  const startedAt = Date.now();
  const result = await run();
  t.diagnostic(`${label}: ${Date.now() - startedAt}ms`);
  return result;
}

function holeCount(result) {
  return result.goalCount + result.invisibleGoalCount;
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

const phases = selectedPhases();

for (const fixture of selectedFixtures()) {
  it(`${fixture.name}: load and batch typecheck match matrix expectations`, async (t) => {
    await withSession(async (session) => {
      const load = phases.has("load")
        ? await timedStep(t, "load", () => session.load(fixture.name))
        : await session.load(fixture.name);

      if (phases.has("load")) {
        assert.equal(load.success, fixture.expectedSuccess);
        assert.equal(load.classification, fixture.expectedClassification);
        assert.ok(
          load.goalCount >= fixture.minVisibleGoalCount,
          `expected >=${fixture.minVisibleGoalCount} visible goals for ${fixture.name}, got ${load.goalCount}`,
        );
        assert.ok(
          holeCount(load) >= fixture.minHoleCount,
          `expected >=${fixture.minHoleCount} total holes for ${fixture.name}, got ${holeCount(load)}`,
        );
      }

      if (phases.has("batch")) {
        const batch = await timedStep(t, "batch", () => typeCheckBatch(fixture.name, FIXTURES));
        assert.equal(batch.success, fixture.expectedSuccess);
        assert.equal(batch.classification, fixture.expectedClassification);
        assert.ok(
          batch.goalCount >= fixture.minVisibleGoalCount,
          `expected >=${fixture.minVisibleGoalCount} batch visible goals for ${fixture.name}, got ${batch.goalCount}`,
        );
        assert.ok(
          holeCount(batch) >= fixture.minHoleCount,
          `expected >=${fixture.minHoleCount} batch total holes for ${fixture.name}, got ${holeCount(batch)}`,
        );
      }

      if (phases.has("strict")) {
        const strict = await timedStep(t, "strict", () => session.loadNoMetas(fixture.name));
        assert.equal(strict.success, fixture.expectedStrictSuccess);
        assert.equal(strict.classification, fixture.expectedStrictClassification);
      }

      if (phases.has("goal") && load.goalCount > 0) {
        const info = await timedStep(t, "goal", () => session.goal.typeContext(load.goals[0].goalId));
        assert.ok(info.type.length > 0, `expected non-empty goal type for ${fixture.name}`);
      }

      if (phases.has("search") && fixture.searchQueries?.length) {
        for (const expectation of fixture.searchQueries) {
          const result = await timedStep(
            t,
            `search:${expectation.query}`,
            () => session.query.searchAbout(expectation.query),
          );
          assert.equal(result.query, expectation.query);
          if (expectation.minResults !== undefined) {
            assert.ok(
              result.results.length >= expectation.minResults,
              `expected >=${expectation.minResults} search results for ${fixture.name} query ${expectation.query}, got ${result.results.length}`,
            );
          }
          for (const expectedName of expectation.expectedNames) {
            assert.ok(
              result.results.some((entry) => entry.name === expectedName),
              `expected search result ${expectedName} for ${fixture.name} query ${expectation.query}`,
            );
          }
        }
      }
    });
  });
}
