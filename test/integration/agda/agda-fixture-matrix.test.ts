import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { AgdaSession, typeCheckBatch } from "../../../src/agda-process.js";
import { fixtureMatrix } from "../../fixtures/agda/fixture-matrix.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

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

async function withSession(run: (session: AgdaSession) => Promise<void>) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await run(session);
  } finally {
    session.destroy();
  }
}

async function timedStep(ctx: any, label: string, run: () => Promise<any>) {
  const startedAt = Date.now();
  const result = await run();
  // Vitest does not have t.diagnostic; use console.log for timing info
  console.log(`${label}: ${Date.now() - startedAt}ms`);
  return result;
}

function holeCount(result: any) {
  return result.goalCount + result.invisibleGoalCount;
}

test("fixture matrix entries reference existing files", () => {
  for (const fixture of fixtureMatrix) {
    expect(
      existsSync(resolve(FIXTURES, fixture.name)),
    ).toBe(true);
  }
});

const phases = selectedPhases();

for (const fixture of selectedFixtures()) {
  it(`${fixture.name}: load and batch typecheck match matrix expectations`, async (ctx) => {
    await withSession(async (session) => {
      const load = phases.has("load")
        ? await timedStep(ctx, "load", () => session.load(fixture.name))
        : await session.load(fixture.name);

      if (phases.has("load")) {
        expect(load.success).toBe(fixture.expectedSuccess);
        expect(load.classification).toBe(fixture.expectedClassification);
        expect(
          load.goalCount >= fixture.minVisibleGoalCount,
        ).toBeTruthy();
        expect(
          holeCount(load) >= fixture.minHoleCount,
        ).toBeTruthy();
      }

      if (phases.has("batch")) {
        const batch = await timedStep(ctx, "batch", () => typeCheckBatch(fixture.name, FIXTURES));
        expect(batch.success).toBe(fixture.expectedSuccess);
        expect(batch.classification).toBe(fixture.expectedClassification);
        expect(
          batch.goalCount >= fixture.minVisibleGoalCount,
        ).toBeTruthy();
        expect(
          holeCount(batch) >= fixture.minHoleCount,
        ).toBeTruthy();
      }

      if (phases.has("strict")) {
        const strict = await timedStep(ctx, "strict", () => session.loadNoMetas(fixture.name));
        expect(strict.success).toBe(fixture.expectedStrictSuccess);
        expect(strict.classification).toBe(fixture.expectedStrictClassification);
      }

      if (phases.has("goal") && load.goalCount > 0) {
        const info = await timedStep(ctx, "goal", () => session.goal.typeContext(load.goals[0].goalId));
        expect(info.type.length > 0).toBeTruthy();
      }

      if (phases.has("search") && fixture.searchQueries?.length) {
        for (const expectation of fixture.searchQueries) {
          const result = await timedStep(
            ctx,
            `search:${expectation.query}`,
            () => session.query.searchAbout(expectation.query),
          );
          expect(result.query).toBe(expectation.query);
          if (expectation.minResults !== undefined) {
            expect(
              result.results.length >= expectation.minResults,
            ).toBeTruthy();
          }
          for (const expectedName of expectation.expectedNames) {
            expect(
              result.results.some((entry: any) => entry.name === expectedName),
            ).toBeTruthy();
          }
        }
      }
    });
  });
}
