import { test, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";
import { parseContextEntry, deriveSuggestions, findMatchingTerms } from "../../../src/agda-process.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/agda");

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
    expect(load.goals.length >= 1).toBeTruthy();

    const info = await session.goal.typeContext(load.goals[0].goalId);
    expect(info.type.length > 0).toBeTruthy();

    // Parse context
    const contextEntries = info.context.map(parseContextEntry);
    for (const entry of contextEntries) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.type).toBe("string");
    }

    // Derive suggestions
    const suggestions = deriveSuggestions(info.type, contextEntries);
    expect(suggestions.length > 0).toBeTruthy();
    expect(suggestions.some((s) => s.action === "auto")).toBeTruthy();
  } finally {
    session.destroy();
  }
});

it("goal analysis: PatternMatch.agda suggests case_split on n", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("PatternMatch.agda");
    expect(load.goals.length >= 1).toBeTruthy();

    const info = await session.goal.typeContext(load.goals[0].goalId);
    const contextEntries = info.context.map(parseContextEntry);
    const suggestions = deriveSuggestions(info.type, contextEntries);

    // Should suggest case_split on n (the Nat argument)
    expect(
      suggestions.some((s) => s.action === "case_split"),
    ).toBeTruthy();
  } finally {
    session.destroy();
  }
});

// ── Term search on real Agda output ──────────────────────

it("term search: finds matching terms in context", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("WithHoles.agda");
    expect(load.goals.length >= 1).toBeTruthy();

    const info = await session.goal.typeContext(load.goals[0].goalId);
    const contextEntries = info.context.map(parseContextEntry);
    const matches = findMatchingTerms(info.type, contextEntries);

    // Just verify it doesn't crash and returns an array
    expect(Array.isArray(matches)).toBeTruthy();
  } finally {
    session.destroy();
  }
});

// ── Proof status ─────────────────────────────────────────

it("proof status: returns goal summary after load", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    const load = await session.load("MultipleHoles.agda");
    expect(load.goals.length >= 2).toBeTruthy();

    // Simulate what agda_proof_status does
    const metas = await session.goal.metas();
    expect(metas.goals.length >= 2).toBeTruthy();
    expect(metas.goals.every((g) => typeof g.goalId === "number")).toBeTruthy();
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

    expect(solved.length).toBe(0);
    expect(created.length).toBe(0);
  } finally {
    session.destroy();
  }
});

it("reload: clean file has 0 goals", async () => {
  const session = new AgdaSession(FIXTURES);
  try {
    // Load holes first, then switch to clean
    await session.load("WithHoles.agda");
    const result = await session.load("CompleteFixture.agda");
    expect(result.success).toBe(true);
    expect(result.goals.length).toBe(0);
  } finally {
    session.destroy();
  }
});
