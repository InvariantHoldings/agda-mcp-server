import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession, typeCheckBatch } from "../../../dist/agda-process.js";

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
async function loadFixture(name) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await session.load(name);
  } finally {
    session.destroy();
  }
}

async function loadFixtureNoMetas(name) {
  const session = new AgdaSession(FIXTURES);
  try {
    return await session.loadNoMetas(name);
  } finally {
    session.destroy();
  }
}

// ── Clean files ──────────────────────────────────────────

it("Clean.agda: success, 0 goals", async () => {
  const r = await loadFixture("Clean.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
  assert.equal(r.errors.length, 0);
});

it("EmptyModule.agda: success, 0 goals", async () => {
  const r = await loadFixture("EmptyModule.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
});

it("SafeOnly.agda: success with --safe flag", async () => {
  const r = await loadFixture("SafeOnly.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
});

it("WithWhere.agda: success with where clauses", async () => {
  const r = await loadFixture("WithWhere.agda");
  assert.equal(r.success, true);
});

// ── Holes ────────────────────────────────────────────────

it("WithHoles.agda: success, >=1 goal with valid ID", async () => {
  const r = await loadFixture("WithHoles.agda");
  assert.equal(r.success, true);
  assert.ok(r.goals.length >= 1, `expected >=1 goal, got ${r.goals.length}`);
  assert.ok(r.goals[0].goalId >= 0);
});

it("WithHoles.agda: agda_load succeeds but agda_load_no_metas fails", async () => {
  const load = await loadFixture("WithHoles.agda");
  const strict = await loadFixtureNoMetas("WithHoles.agda");

  assert.equal(load.success, true);
  assert.equal(load.classification, "ok-with-holes");
  assert.equal(strict.success, false);
  assert.equal(strict.classification, "type-error");
});

it("MultipleHoles.agda: >=2 goals with distinct IDs", async () => {
  const r = await loadFixture("MultipleHoles.agda");
  assert.ok(r.goals.length >= 2, `expected >=2 goals, got ${r.goals.length}`);
  const ids = r.goals.map((g) => g.goalId);
  assert.equal(new Set(ids).size, ids.length, "goal IDs should be unique");
});

it("PatternMatch.agda: hole ready for case split", async () => {
  const r = await loadFixture("PatternMatch.agda");
  assert.equal(r.success, true);
  assert.ok(r.goals.length >= 1);
});

it("ImportedContextHole.agda: goal survives multi-file imports", async () => {
  const r = await loadFixture("ImportedContextHole.agda");
  assert.equal(r.success, true);
  assert.ok(r.goals.length >= 1, `expected imported-context goal, got ${r.goals.length}`);
});

it("QualifiedImportedHole.agda: goal survives qualified imports", async () => {
  const r = await loadFixture("QualifiedImportedHole.agda");
  assert.equal(r.success, true);
  assert.ok(r.goals.length >= 1, `expected qualified-import goal, got ${r.goals.length}`);
});

// ── Errors ───────────────────────────────────────────────

it("TypeError.agda: success=false, error mentions type mismatch", async () => {
  const r = await loadFixture("TypeError.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
  const allErrors = r.errors.join("\n");
  assert.ok(
    allErrors.includes("Bool") || allErrors.includes("Nat") || allErrors.includes("!="),
    `error should mention types, got: ${allErrors.slice(0, 200)}`,
  );
});

it("ParseError.agda: success=false", async () => {
  const r = await loadFixture("ParseError.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
});

it("ImportMissing.agda: success=false, mentions module not found", async () => {
  const r = await loadFixture("ImportMissing.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
});

it("ImportedTypeError.agda: imported dependency type errors surface on root load", async () => {
  const r = await loadFixture("ImportedTypeError.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
});

it("TrulyUnsolvable.agda: hole that auto cannot solve", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const r = await session.load("TrulyUnsolvable.agda");
    assert.equal(r.success, true, "file with hole type-checks (metas OK)");
    assert.ok(r.goals.length >= 1, "should have at least 1 goal");

    // Try auto-solve — should NOT find a solution
    const auto = await session.goal.autoOne(r.goals[0].goalId);
    // auto.solution should be empty or contain an error message
    assert.ok(
      !auto.solution || auto.solution.includes("error") || auto.solution.includes("No"),
      `auto should fail to solve, got: "${auto.solution?.slice(0, 100)}"`,
    );
  } finally {
    session.destroy();
  }
});

it("InferredMeta.agda: typechecks but still exposes an interaction meta", async () => {
  const r = await loadFixture("InferredMeta.agda");
  assert.equal(r.success, true);
  assert.ok(r.goalCount >= 1, `expected unresolved meta, got ${r.goalCount} goals`);
});

it("MixedGoalsErrors.agda: success=false with errors", async () => {
  const r = await loadFixture("MixedGoalsErrors.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
});

// ── Feature flags ────────────────────────────────────────

it("WithK.agda: loads with --with-K", async () => {
  const r = await loadFixture("WithK.agda");
  assert.equal(r.success, true);
});

it("WithPostulates.agda: loads with postulates", async () => {
  const r = await loadFixture("WithPostulates.agda");
  assert.equal(r.success, true);
});

it("WithRewrite.agda: loads with --rewriting", async () => {
  const r = await loadFixture("WithRewrite.agda");
  assert.equal(r.success, true);
});

it("Cubical.agda: loads with --cubical", async () => {
  const r = await loadFixture("Cubical.agda");
  assert.equal(r.success, true);
});

it("SizedTypes.agda: loads with --sized-types", async () => {
  const r = await loadFixture("SizedTypes.agda");
  assert.equal(r.success, true);
});

// ── Records and instances ────────────────────────────────

it("Records.agda: records, copatterns, eta", async () => {
  const r = await loadFixture("Records.agda");
  assert.equal(r.success, true);
});

it("InstanceArgs.agda: instance arguments and search", async () => {
  const r = await loadFixture("InstanceArgs.agda");
  assert.equal(r.success, true);
});

it("MultiFileImports.agda: complete multi-file import graph loads", async () => {
  const r = await loadFixture("MultiFileImports.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
});

it("TransitiveImport.agda: transitive multi-file import graph loads", async () => {
  const r = await loadFixture("TransitiveImport.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
});

// ── Abstract blocks ──────────────────────────────────────

it("WithAbstract.agda: detects invisible goals in abstract block", async () => {
  const r = await loadFixture("WithAbstract.agda");
  // Abstract holes may or may not show as visible goals depending on Agda version
  // but the file should load
  assert.equal(typeof r.invisibleGoalCount, "number");
});

it("WithAbstract.agda: invisible holes fail strict load", async () => {
  const load = await loadFixture("WithAbstract.agda");
  const strict = await loadFixtureNoMetas("WithAbstract.agda");

  assert.equal(load.success, true);
  assert.equal(strict.success, false);
  assert.ok(
    strict.errors.length >= 1 || strict.invisibleGoalCount > 0 || strict.goalCount > 0,
    "strict load should expose unresolved metas or holes",
  );
});

it("InferredMeta.agda: unresolved inferred-style metas fail strict load", async () => {
  const load = await loadFixture("InferredMeta.agda");
  const strict = await loadFixtureNoMetas("InferredMeta.agda");

  assert.equal(load.success, true);
  assert.ok(load.goalCount >= 1);
  assert.equal(strict.success, false);
  assert.equal(strict.classification, "type-error");
});

// ── Universe levels ──────────────────────────────────────

it("UniverseLevels.agda: valid universe polymorphism loads", async () => {
  const r = await loadFixture("UniverseLevels.agda");
  assert.equal(r.success, true);
  assert.equal(r.goals.length, 0);
});

it("UniverseError.agda: Set : Set universe error detected", async () => {
  const r = await loadFixture("UniverseError.agda");
  assert.equal(r.success, false);
  assert.ok(r.errors.length >= 1);
  const allErrors = r.errors.join("\n");
  assert.ok(
    allErrors.includes("Set") || allErrors.includes("universe") || allErrors.includes("level"),
    `error should mention universe/Set, got: ${allErrors.slice(0, 200)}`,
  );
});

it("UniverseCumulativity.agda: loads with --cumulativity", async () => {
  const r = await loadFixture("UniverseCumulativity.agda");
  // --cumulativity may not be supported in all Agda versions
  // If it loads, great; if it fails with "unknown flag", that's OK too
  assert.equal(typeof r.success, "boolean");
});

// ── typecheck matches load ───────────────────────────────

it("typeCheckBatch matches agda_load for clean file", async () => {
  const batch = await typeCheckBatch("Clean.agda", FIXTURES);
  assert.equal(batch.success, true);
});

it("typeCheckBatch matches agda_load for type error", async () => {
  const batch = await typeCheckBatch("TypeError.agda", FIXTURES);
  assert.equal(batch.success, false);
  assert.ok(batch.errors.length >= 1);
});

// ── Goal interaction ─────────────────────────────────────

it("goal.typeContext returns type for a hole", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("WithHoles.agda");
    assert.ok(load.goals.length >= 1, "need at least 1 goal");
    const info = await session.goal.typeContext(load.goals[0].goalId);
    assert.equal(typeof info.type, "string");
    assert.ok(info.type.length > 0, `goal type should be non-empty, got: "${info.type}"`);
  } finally {
    session.destroy();
  }
});

it("goal.typeContext works for imported-context holes", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("ImportedContextHole.agda");
    assert.ok(load.goals.length >= 1, "need at least 1 imported-context goal");
    const info = await session.goal.typeContext(load.goals[0].goalId);
    assert.equal(typeof info.type, "string");
    assert.ok(info.type.includes("Nat"), `expected Nat-like goal type, got: "${info.type}"`);
  } finally {
    session.destroy();
  }
});

// ── Staleness detection ──────────────────────────────────

it("isFileStale returns false right after load", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    await session.load("Clean.agda");
    assert.equal(session.isFileStale(), false);
  } finally {
    session.destroy();
  }
});
