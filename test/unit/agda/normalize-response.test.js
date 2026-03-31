import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAgdaResponse } from "../../../dist/agda/normalize-response.js";

// ── InteractionPoints ─────────────────────────────────────

test("normalizes InteractionPoints number[] (no-op)", () => {
  const input = { kind: "InteractionPoints", interactionPoints: [0, 1, 2] };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.interactionPoints, [0, 1, 2]);
});

test("normalizes InteractionPoints {id}[] → number[]", () => {
  const input = {
    kind: "InteractionPoints",
    interactionPoints: [{ id: 0 }, { id: 1 }],
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.interactionPoints, [0, 1]);
});

// ── DisplayInfo AllGoalsWarnings ──────────────────────────

test("normalizes AllGoalsWarnings string fields → single-element arrays", () => {
  const input = {
    kind: "DisplayInfo",
    info: {
      kind: "AllGoalsWarnings",
      visibleGoals: "?0 : Nat",
      invisibleGoals: "hidden",
      errors: "some error",
      warnings: "some warning",
    },
  };
  const result = normalizeAgdaResponse(input);
  const info = result.info;
  assert.deepEqual(info.visibleGoals, ["?0 : Nat"]);
  assert.deepEqual(info.invisibleGoals, ["hidden"]);
  assert.deepEqual(info.errors, ["some error"]);
  assert.deepEqual(info.warnings, ["some warning"]);
});

test("normalizes AllGoalsWarnings arrays pass through", () => {
  const goals = [{ constraintObj: 0, type: "Nat", range: {} }];
  const errs = [{ range: {}, message: "type mismatch" }];
  const input = {
    kind: "DisplayInfo",
    info: {
      kind: "AllGoalsWarnings",
      visibleGoals: goals,
      invisibleGoals: [],
      errors: errs,
      warnings: [],
    },
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.info.visibleGoals, goals);
  assert.deepEqual(result.info.errors, errs);
});

test("normalizes AllGoalsWarnings empty string → empty array", () => {
  const input = {
    kind: "DisplayInfo",
    info: {
      kind: "AllGoalsWarnings",
      visibleGoals: "",
      invisibleGoals: "",
      errors: "",
      warnings: "",
    },
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.info.visibleGoals, []);
  assert.deepEqual(result.info.errors, []);
});

// ── DisplayInfo Error ─────────────────────────────────────

test("normalizes DisplayInfo Error message stays string", () => {
  const input = {
    kind: "DisplayInfo",
    info: { kind: "Error", message: "type mismatch" },
  };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.info.message, "type mismatch");
});

// ── GiveAction ────────────────────────────────────────────

test("normalizes GiveAction string giveResult (no-op)", () => {
  const input = { kind: "GiveAction", giveResult: "refl" };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.giveResult, "refl");
});

test("normalizes GiveAction array giveResult → joined string", () => {
  const input = { kind: "GiveAction", giveResult: ["refl", "sym"] };
  const result = normalizeAgdaResponse(input);
  assert.equal(typeof result.giveResult, "string");
  assert.ok(result.giveResult.includes("refl"));
});

test("normalizes GiveAction object giveResult → string", () => {
  const input = { kind: "GiveAction", giveResult: { str: "refl" } };
  const result = normalizeAgdaResponse(input);
  assert.equal(typeof result.giveResult, "string");
  assert.equal(result.giveResult, "refl");
});

// ── MakeCase ──────────────────────────────────────────────

test("normalizes MakeCase string[] clauses (no-op)", () => {
  const input = {
    kind: "MakeCase",
    clauses: ["f zero = ?", "f (suc n) = ?"],
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.clauses, ["f zero = ?", "f (suc n) = ?"]);
});

test("normalizes MakeCase object[] clauses → string[]", () => {
  const input = { kind: "MakeCase", clauses: [{ type: "f zero = ?" }] };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.clauses, ["f zero = ?"]);
});

// ── RunningInfo ───────────────────────────────────────────

test("normalizes RunningInfo string message (no-op)", () => {
  const input = { kind: "RunningInfo", message: "Checking Module" };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.message, "Checking Module");
});

test("normalizes RunningInfo array message → string", () => {
  const input = { kind: "RunningInfo", message: ["Checking", "Module"] };
  const result = normalizeAgdaResponse(input);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.includes("Checking"));
});

// ── StderrOutput ──────────────────────────────────────────

test("normalizes StderrOutput string text (no-op)", () => {
  const input = { kind: "StderrOutput", text: "warning" };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.text, "warning");
});

// ── SolveAll ──────────────────────────────────────────────

test("normalizes SolveAll tuple solutions → object form", () => {
  const input = {
    kind: "SolveAll",
    solutions: [
      [0, "refl"],
      [1, "zero"],
    ],
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.solutions, [
    { interactionPoint: 0, expression: "refl" },
    { interactionPoint: 1, expression: "zero" },
  ]);
});

test("normalizes SolveAll object solutions (no-op)", () => {
  const input = {
    kind: "SolveAll",
    solutions: [{ interactionPoint: 0, expression: "refl" }],
  };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result.solutions, [
    { interactionPoint: 0, expression: "refl" },
  ]);
});

// ── Status ────────────────────────────────────────────────

test("normalizes Status nested .status → flat fields", () => {
  const input = {
    kind: "Status",
    status: {
      checked: true,
      showImplicitArguments: false,
      showIrrelevantArguments: true,
    },
  };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.checked, true);
  assert.equal(result.showImplicitArguments, false);
  assert.equal(result.showIrrelevantArguments, true);
});

test("normalizes Status flat fields (no-op)", () => {
  const input = {
    kind: "Status",
    checked: true,
    showImplicitArguments: false,
  };
  const result = normalizeAgdaResponse(input);
  assert.equal(result.checked, true);
});

// ── Unknown kinds pass through ────────────────────────────

test("unknown kinds pass through unchanged", () => {
  const input = { kind: "ClearRunningInfo", foo: "bar" };
  const result = normalizeAgdaResponse(input);
  assert.deepEqual(result, input);
});

// ── Does not mutate input ─────────────────────────────────

test("returns new object, does not mutate input", () => {
  const input = {
    kind: "InteractionPoints",
    interactionPoints: [{ id: 0 }],
  };
  const result = normalizeAgdaResponse(input);
  assert.notStrictEqual(result, input);
  assert.deepEqual(input.interactionPoints, [{ id: 0 }]);
});
