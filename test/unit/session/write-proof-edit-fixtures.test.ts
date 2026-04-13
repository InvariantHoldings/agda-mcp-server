import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { readFile, mkdtemp, rm, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { findGoalPositions } from "../../../src/session/goal-positions.js";
import { applyProofEdit } from "../../../src/session/apply-proof-edit.js";

const fixturesDir = resolve(__dirname, "../../fixtures/agda");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// ── Scanner tests against real fixtures ──────────────────────────────

describe("goal scanner on fixture files", () => {
  test("WriteGiveSimple.agda has 3 holes", () => {
    const positions = findGoalPositions(fixture("WriteGiveSimple.agda"));
    expect(positions).toHaveLength(3);
    expect(positions.every((p) => p.markerText === "{!!}")).toBe(true);
  });

  test("WriteGiveQuestionMarks.agda has 2 question-mark holes", () => {
    const positions = findGoalPositions(fixture("WriteGiveQuestionMarks.agda"));
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => p.markerText === "?")).toBe(true);
  });

  test("WriteCaseSplit.agda has 2 holes", () => {
    const positions = findGoalPositions(fixture("WriteCaseSplit.agda"));
    expect(positions).toHaveLength(2);
  });

  test("WriteTrickyHoles.agda has 4 holes with various patterns", () => {
    const positions = findGoalPositions(fixture("WriteTrickyHoles.agda"));
    expect(positions).toHaveLength(4);
    expect(positions[0].markerText).toBe("{! zero !}");
    expect(positions[1].markerText).toBe("{!!}");
    expect(positions[2].markerText).toBe("{! {! zero !} !}");
    expect(positions[3].markerText).toBe("{! {- !} -} zero !}");
  });

  test("WriteGiveEquality.agda has 2 holes", () => {
    const positions = findGoalPositions(fixture("WriteGiveEquality.agda"));
    expect(positions).toHaveLength(2);
  });

  test("expected files have 0 holes", () => {
    for (const name of [
      "WriteGiveSimple.expected.agda",
      "WriteGiveQuestionMarks.expected.agda",
      "WriteCaseSplit.expected.agda",
      "WriteGiveEquality.expected.agda",
    ]) {
      const positions = findGoalPositions(fixture(name));
      expect(positions, `${name} should have no holes`).toHaveLength(0);
    }
  });
});

// ── File edit tests against expected output ──────────────────────────

describe("file edits produce expected output", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agda-fixture-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function copyFixture(name: string): Promise<string> {
    const dest = join(tempDir, name);
    await copyFile(join(fixturesDir, name), dest);
    return dest;
  }

  test("give to all holes in WriteGiveSimple produces expected output", async () => {
    const file = await copyFixture("WriteGiveSimple.agda");

    // Goal 0: myZero = zero
    await applyProofEdit(file, [0, 1, 2], {
      kind: "replace-hole", goalId: 0, expr: "zero",
    });
    // Goal 1: add zero m = m
    await applyProofEdit(file, [1, 2], {
      kind: "replace-hole", goalId: 1, expr: "m",
    });
    // Goal 2: add (suc n) m = suc (add n m)
    await applyProofEdit(file, [2], {
      kind: "replace-hole", goalId: 2, expr: "suc (add n m)",
    });

    const result = await readFile(file, "utf-8");
    const expected = fixture("WriteGiveSimple.expected.agda");
    expect(result).toBe(expected);
  });

  test("give to all ? holes in WriteGiveQuestionMarks produces expected output", async () => {
    const file = await copyFixture("WriteGiveQuestionMarks.agda");

    await applyProofEdit(file, [0, 1], {
      kind: "replace-hole", goalId: 0, expr: "zero",
    });
    await applyProofEdit(file, [1], {
      kind: "replace-hole", goalId: 1, expr: "suc zero",
    });

    const result = await readFile(file, "utf-8");
    const expected = fixture("WriteGiveQuestionMarks.expected.agda");
    expect(result).toBe(expected);
  });

  test("case split in WriteCaseSplit produces expected output", async () => {
    const file = await copyFixture("WriteCaseSplit.agda");

    await applyProofEdit(file, [0, 1], {
      kind: "replace-line", goalId: 0,
      clauses: ["not true = false", "not false = true"],
    });
    await applyProofEdit(file, [1], {
      kind: "replace-line", goalId: 1,
      clauses: ["isZero zero = true", "isZero (suc n) = false"],
    });

    const result = await readFile(file, "utf-8");
    const expected = fixture("WriteCaseSplit.expected.agda");
    expect(result).toBe(expected);
  });

  test("give refl to all holes in WriteGiveEquality produces expected output", async () => {
    const file = await copyFixture("WriteGiveEquality.agda");

    await applyProofEdit(file, [0, 1], {
      kind: "replace-hole", goalId: 0, expr: "refl",
    });
    await applyProofEdit(file, [1], {
      kind: "replace-hole", goalId: 1, expr: "refl",
    });

    const result = await readFile(file, "utf-8");
    const expected = fixture("WriteGiveEquality.expected.agda");
    expect(result).toBe(expected);
  });
});
