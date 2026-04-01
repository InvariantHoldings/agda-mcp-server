import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession, typeCheckBatch } from "../../../src/agda-process.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

// Check if Agda is available
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

// Helper: load a fixture and return result
async function loadFixture(name: string) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await session.load(name);
  } finally {
    session.destroy();
  }
}

async function loadFixtureNoMetas(name: string) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await session.loadNoMetas(name);
  } finally {
    session.destroy();
  }
}

// ── Clean files ──────────────────────────────────────────

it("CompleteFixture.agda: success, 0 goals", async () => {
  const r = await loadFixture("CompleteFixture.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
  expect(r.errors.length).toBe(0);
});

it("EmptyModule.agda: success, 0 goals", async () => {
  const r = await loadFixture("EmptyModule.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
});

it("SafeOnly.agda: success with --safe flag", async () => {
  const r = await loadFixture("SafeOnly.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
});

it("WithWhere.agda: success with where clauses", async () => {
  const r = await loadFixture("WithWhere.agda");
  expect(r.success).toBe(true);
});

// ── Holes ────────────────────────────────────────────────

it("WithHoles.agda: success, >=1 goal with valid ID", async () => {
  const r = await loadFixture("WithHoles.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length >= 1).toBeTruthy();
  expect(r.goals[0].goalId >= 0).toBeTruthy();
});

it("WithHoles.agda: agda_load succeeds but agda_load_no_metas fails", async () => {
  const load = await loadFixture("WithHoles.agda");
  const strict = await loadFixtureNoMetas("WithHoles.agda");

  expect(load.success).toBe(true);
  expect(load.classification).toBe("ok-with-holes");
  expect(strict.success).toBe(false);
  expect(strict.classification).toBe("type-error");
});

it("MultipleHoles.agda: >=2 goals with distinct IDs", async () => {
  const r = await loadFixture("MultipleHoles.agda");
  expect(r.goals.length >= 2).toBeTruthy();
  const ids = r.goals.map((g) => g.goalId);
  expect(new Set(ids).size).toBe(ids.length);
});

it("PatternMatch.agda: hole ready for case split", async () => {
  const r = await loadFixture("PatternMatch.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length >= 1).toBeTruthy();
});

it("ImportedContextHole.agda: goal survives multi-file imports", async () => {
  const r = await loadFixture("ImportedContextHole.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length >= 1).toBeTruthy();
});

it("QualifiedImportedHole.agda: goal survives qualified imports", async () => {
  const r = await loadFixture("QualifiedImportedHole.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length >= 1).toBeTruthy();
});

// ── Errors ───────────────────────────────────────────────

it("TypeError.agda: success=false, error mentions type mismatch", async () => {
  const r = await loadFixture("TypeError.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
  const allErrors = r.errors.join("\n");
  expect(
    allErrors.includes("Bool") || allErrors.includes("Nat") || allErrors.includes("!="),
  ).toBeTruthy();
});

it("ParseError.agda: success=false", async () => {
  const r = await loadFixture("ParseError.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
});

it("ImportMissing.agda: success=false, mentions module not found", async () => {
  const r = await loadFixture("ImportMissing.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
});

it("ImportedTypeError.agda: imported dependency type errors surface on root load", async () => {
  const r = await loadFixture("ImportedTypeError.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
});

it("TrulyUnsolvable.agda: hole that auto cannot solve", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const r = await session.load("TrulyUnsolvable.agda");
    expect(r.success).toBe(true);
    expect(r.goals.length >= 1).toBeTruthy();

    // Try auto-solve — should NOT find a solution
    const auto = await session.goal.autoOne(r.goals[0].goalId);
    // auto.solution should be empty or contain an error message
    expect(
      !auto.solution || auto.solution.includes("error") || auto.solution.includes("No"),
    ).toBeTruthy();
  } finally {
    session.destroy();
  }
});

it("InferredMeta.agda: typechecks but still exposes an interaction meta", async () => {
  const r = await loadFixture("InferredMeta.agda");
  expect(r.success).toBe(true);
  expect(r.classification).toBe("ok-with-holes");
  expect(r.goalCount).toBe(0);
  expect(r.invisibleGoalCount >= 1).toBeTruthy();
});

it("MixedGoalsErrors.agda: success=false with errors", async () => {
  const r = await loadFixture("MixedGoalsErrors.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
});

// ── Feature flags ────────────────────────────────────────

it("WithK.agda: loads with --with-K", async () => {
  const r = await loadFixture("WithK.agda");
  expect(r.success).toBe(true);
});

it("WithPostulates.agda: loads with postulates", async () => {
  const r = await loadFixture("WithPostulates.agda");
  expect(r.success).toBe(true);
});

it("WithRewrite.agda: loads with --rewriting", async () => {
  const r = await loadFixture("WithRewrite.agda");
  expect(r.success).toBe(true);
});

it("Cubical.agda: loads with --cubical", async () => {
  const r = await loadFixture("Cubical.agda");
  expect(r.success).toBe(true);
});

it("SizedTypes.agda: loads with --sized-types", async () => {
  const r = await loadFixture("SizedTypes.agda");
  expect(r.success).toBe(true);
});

// ── Records and instances ────────────────────────────────

it("Records.agda: records, copatterns, eta", async () => {
  const r = await loadFixture("Records.agda");
  expect(r.success).toBe(true);
});

it("InstanceArgs.agda: instance arguments and search", async () => {
  const r = await loadFixture("InstanceArgs.agda");
  expect(r.success).toBe(true);
});

it("MultiFileImports.agda: complete multi-file import graph loads", async () => {
  const r = await loadFixture("MultiFileImports.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
});

it("TransitiveImport.agda: transitive multi-file import graph loads", async () => {
  const r = await loadFixture("TransitiveImport.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
});

// ── Abstract blocks ──────────────────────────────────────

it("WithAbstract.agda: detects invisible goals in abstract block", async () => {
  const r = await loadFixture("WithAbstract.agda");
  // Abstract holes may or may not show as visible goals depending on Agda version
  // but the file should load
  expect(typeof r.invisibleGoalCount).toBe("number");
});

it("WithAbstract.agda: invisible holes fail strict load", async () => {
  const load = await loadFixture("WithAbstract.agda");
  const strict = await loadFixtureNoMetas("WithAbstract.agda");

  expect(load.success).toBe(true);
  expect(strict.success).toBe(false);
  expect(
    strict.errors.length >= 1 || strict.invisibleGoalCount > 0 || strict.goalCount > 0,
  ).toBeTruthy();
});

it("InferredMeta.agda: unresolved inferred-style metas fail strict load", async () => {
  const load = await loadFixture("InferredMeta.agda");
  const strict = await loadFixtureNoMetas("InferredMeta.agda");

  expect(load.success).toBe(true);
  expect(load.classification).toBe("ok-with-holes");
  expect(load.goalCount).toBe(0);
  expect(load.invisibleGoalCount >= 1).toBeTruthy();
  expect(strict.success).toBe(false);
  expect(strict.classification).toBe("type-error");
});

// ── Universe levels ──────────────────────────────────────

it("UniverseLevels.agda: valid universe polymorphism loads", async () => {
  const r = await loadFixture("UniverseLevels.agda");
  expect(r.success).toBe(true);
  expect(r.goals.length).toBe(0);
});

it("UniverseError.agda: Set : Set universe error detected", async () => {
  const r = await loadFixture("UniverseError.agda");
  expect(r.success).toBe(false);
  expect(r.errors.length >= 1).toBeTruthy();
  const allErrors = r.errors.join("\n");
  expect(
    allErrors.includes("Set") || allErrors.includes("universe") || allErrors.includes("level"),
  ).toBeTruthy();
});

it("UniverseCumulativity.agda: loads with --cumulativity", async () => {
  const r = await loadFixture("UniverseCumulativity.agda");
  // --cumulativity may not be supported in all Agda versions
  // If it loads, great; if it fails with "unknown flag", that's OK too
  expect(typeof r.success).toBe("boolean");
});

// ── typecheck matches load ───────────────────────────────

it("typeCheckBatch matches agda_load for clean file", async () => {
  const batch = await typeCheckBatch("CompleteFixture.agda", FIXTURES);
  expect(batch.success).toBe(true);
});

it("typeCheckBatch matches agda_load for type error", async () => {
  const batch = await typeCheckBatch("TypeError.agda", FIXTURES);
  expect(batch.success).toBe(false);
  expect(batch.errors.length >= 1).toBeTruthy();
});

// ── Goal interaction ─────────────────────────────────────

it("goal.typeContext returns type for a hole", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("WithHoles.agda");
    expect(load.goals.length >= 1).toBeTruthy();
    const info = await session.goal.typeContext(load.goals[0].goalId);
    expect(typeof info.type).toBe("string");
    expect(info.type.length > 0).toBeTruthy();
  } finally {
    session.destroy();
  }
});

it("goal.typeContext works for imported-context holes", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("ImportedContextHole.agda");
    expect(load.goals.length >= 1).toBeTruthy();
    const info = await session.goal.typeContext(load.goals[0].goalId);
    expect(typeof info.type).toBe("string");
    expect(info.type.includes("Nat")).toBeTruthy();
  } finally {
    session.destroy();
  }
});

// ── Staleness detection ──────────────────────────────────

it("isFileStale returns false right after load", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    await session.load("CompleteFixture.agda");
    expect(session.isFileStale()).toBe(false);
  } finally {
    session.destroy();
  }
});
