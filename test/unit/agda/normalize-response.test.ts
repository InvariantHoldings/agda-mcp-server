import { test, expect } from "vitest";

import { normalizeAgdaResponse } from "../../../src/agda/normalize-response.js";

// ── InteractionPoints ─────────────────────────────────────

test("normalizes InteractionPoints number[] (no-op)", () => {
  const input = { kind: "InteractionPoints", interactionPoints: [0, 1, 2] };
  const result = normalizeAgdaResponse(input);
  expect(result.interactionPoints).toEqual([0, 1, 2]);
});

test("normalizes InteractionPoints {id}[] → number[]", () => {
  const input = {
    kind: "InteractionPoints",
    interactionPoints: [{ id: 0 }, { id: 1 }],
  };
  const result = normalizeAgdaResponse(input);
  expect(result.interactionPoints).toEqual([0, 1]);
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
  expect(info.visibleGoals).toEqual(["?0 : Nat"]);
  expect(info.invisibleGoals).toEqual(["hidden"]);
  expect(info.errors).toEqual(["some error"]);
  expect(info.warnings).toEqual(["some warning"]);
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
  expect(result.info.visibleGoals).toEqual(goals);
  expect(result.info.errors).toEqual(errs);
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
  expect(result.info.visibleGoals).toEqual([]);
  expect(result.info.errors).toEqual([]);
});

// ── DisplayInfo Error ─────────────────────────────────────

test("normalizes DisplayInfo Error message stays string", () => {
  const input = {
    kind: "DisplayInfo",
    info: { kind: "Error", message: "type mismatch" },
  };
  const result = normalizeAgdaResponse(input);
  expect(result.info.message).toBe("type mismatch");
});

// ── GiveAction ────────────────────────────────────────────

test("normalizes GiveAction string giveResult (no-op)", () => {
  const input = { kind: "GiveAction", giveResult: "refl" };
  const result = normalizeAgdaResponse(input);
  expect(result.giveResult).toBe("refl");
});

test("normalizes GiveAction array giveResult → joined string", () => {
  const input = { kind: "GiveAction", giveResult: ["refl", "sym"] };
  const result = normalizeAgdaResponse(input);
  expect(typeof result.giveResult).toBe("string");
  expect(result.giveResult.includes("refl")).toBeTruthy();
});

test("normalizes GiveAction object giveResult → string", () => {
  const input = { kind: "GiveAction", giveResult: { str: "refl" } };
  const result = normalizeAgdaResponse(input);
  expect(typeof result.giveResult).toBe("string");
  expect(result.giveResult).toBe("refl");
});

// ── MakeCase ──────────────────────────────────────────────

test("normalizes MakeCase string[] clauses (no-op)", () => {
  const input = {
    kind: "MakeCase",
    clauses: ["f zero = ?", "f (suc n) = ?"],
  };
  const result = normalizeAgdaResponse(input);
  expect(result.clauses).toEqual(["f zero = ?", "f (suc n) = ?"]);
});

test("normalizes MakeCase object[] clauses → string[]", () => {
  const input = { kind: "MakeCase", clauses: [{ type: "f zero = ?" }] };
  const result = normalizeAgdaResponse(input);
  expect(result.clauses).toEqual(["f zero = ?"]);
});

// ── RunningInfo ───────────────────────────────────────────

test("normalizes RunningInfo string message (no-op)", () => {
  const input = { kind: "RunningInfo", message: "Checking Module" };
  const result = normalizeAgdaResponse(input);
  expect(result.message).toBe("Checking Module");
});

test("normalizes RunningInfo array message → string", () => {
  const input = { kind: "RunningInfo", message: ["Checking", "Module"] };
  const result = normalizeAgdaResponse(input);
  expect(typeof result.message).toBe("string");
  expect(result.message.includes("Checking")).toBeTruthy();
});

// ── StderrOutput ──────────────────────────────────────────

test("normalizes StderrOutput string text (no-op)", () => {
  const input = { kind: "StderrOutput", text: "warning" };
  const result = normalizeAgdaResponse(input);
  expect(result.text).toBe("warning");
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
  expect(result.solutions).toEqual([
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
  expect(result.solutions).toEqual([
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
  expect(result.checked).toBe(true);
  expect(result.showImplicitArguments).toBe(false);
  expect(result.showIrrelevantArguments).toBe(true);
});

test("normalizes Status flat fields (no-op)", () => {
  const input = {
    kind: "Status",
    checked: true,
    showImplicitArguments: false,
  };
  const result = normalizeAgdaResponse(input);
  expect(result.checked).toBe(true);
});

// ── Unknown kinds pass through ────────────────────────────

test("unknown kinds pass through unchanged", () => {
  const input = { kind: "ClearRunningInfo", foo: "bar" };
  const result = normalizeAgdaResponse(input);
  expect(result).toEqual(input);
});

// ── Does not mutate input ─────────────────────────────────

test("returns new object, does not mutate input", () => {
  const input = {
    kind: "InteractionPoints",
    interactionPoints: [{ id: 0 }],
  };
  const result = normalizeAgdaResponse(input);
  expect(result).not.toBe(input);
  expect(input.interactionPoints).toEqual([{ id: 0 }]);
});
