import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../dist/agda-process.js";
import { parseContextEntry, deriveSuggestions, findMatchingTerms } from "../../dist/agda-process.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/agda");

let agdaAvailable = false;
try {
  execSync("agda --version", { stdio: "pipe" });
  agdaAvailable = true;
} catch { /* */ }

const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1"
  ? test
  : test.skip;

// ── Goal analysis on real Agda output ────────────────────

it("goal analysis: WithHoles.agda returns Nat type and suggestions", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("WithHoles.agda");
    assert.ok(load.goals.length >= 1);

    const info = await session.goal.typeContext(load.goals[0].goalId);
    assert.ok(info.type.length > 0, "goal type should be non-empty");

    // Parse context
    const contextEntries = info.context.map(parseContextEntry);
    for (const entry of contextEntries) {
      assert.equal(typeof entry.name, "string");
      assert.equal(typeof entry.type, "string");
    }

    // Derive suggestions
    const suggestions = deriveSuggestions(info.type, contextEntries);
    assert.ok(suggestions.length > 0, "should have at least one suggestion");
    assert.ok(suggestions.some((s) => s.action === "auto"), "should include auto");
  } finally {
    session.destroy();
  }
});

it("goal analysis: PatternMatch.agda suggests case_split on n", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("PatternMatch.agda");
    assert.ok(load.goals.length >= 1);

    const info = await session.goal.typeContext(load.goals[0].goalId);
    const contextEntries = info.context.map(parseContextEntry);
    const suggestions = deriveSuggestions(info.type, contextEntries);

    // Should suggest case_split on n (the Nat argument)
    assert.ok(
      suggestions.some((s) => s.action === "case_split"),
      "should suggest case_split for pattern matching",
    );
  } finally {
    session.destroy();
  }
});

// ── Term search on real Agda output ──────────────────────

it("term search: finds matching terms in context", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("WithHoles.agda");
    assert.ok(load.goals.length >= 1);

    const info = await session.goal.typeContext(load.goals[0].goalId);
    const contextEntries = info.context.map(parseContextEntry);
    const matches = findMatchingTerms(info.type, contextEntries);

    // Just verify it doesn't crash and returns an array
    assert.ok(Array.isArray(matches));
  } finally {
    session.destroy();
  }
});

// ── Proof status ─────────────────────────────────────────

it("proof status: returns goal summary after load", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("MultipleHoles.agda");
    assert.ok(load.goals.length >= 2);

    // Simulate what agda_proof_status does
    const metas = await session.goal.metas();
    assert.ok(metas.goals.length >= 2);
    assert.ok(metas.goals.every((g) => typeof g.goalId === "number"));
  } finally {
    session.destroy();
  }
});

// ── Reload with diff ─────────────────────────────────────

it("reload: same file produces no solved/created diff", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const first = await session.load("WithHoles.agda");
    const prevIds = first.goals.map((g) => g.goalId);

    // Reload same file (no changes)
    const second = await session.load(session.getLoadedFile());
    const newIds = second.goals.map((g) => g.goalId);

    const solved = prevIds.filter((id) => !newIds.includes(id));
    const created = newIds.filter((id) => !prevIds.includes(id));

    assert.equal(solved.length, 0, "no goals should be solved on same-file reload");
    assert.equal(created.length, 0, "no goals should be created on same-file reload");
  } finally {
    session.destroy();
  }
});

it("reload: clean file has 0 goals", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    // Load holes first, then switch to clean
    await session.load("WithHoles.agda");
    const result = await session.load("Clean.agda");
    assert.equal(result.success, true);
    assert.equal(result.goals.length, 0);
  } finally {
    session.destroy();
  }
});
