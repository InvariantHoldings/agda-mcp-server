import { test, expect } from "vitest";

import {
  extractEarliestErrorLine,
  parseLoadResponses,
} from "../../../src/agda/parse-load-responses.js";

// All inputs are pre-normalized (arrays, not strings).

test("clean load — no errors, no goals", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ]);
  expect(result.success).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.goals).toEqual([]);
  expect(result.goalIds).toEqual([]);
  expect(result.invisibleGoalCount).toBe(0);
});

test("load with interaction points → goals populated", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0, 1] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: 0, type: "Nat" },
          { constraintObj: 1, type: "Bool" },
        ],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  expect(result.success).toBe(true);
  expect(result.goals.length).toBe(2);
  expect(result.goals[0].goalId).toBe(0);
  expect(result.goals[0].type).toBe("Nat");
  expect(result.goals[1].goalId).toBe(1);
  expect(result.goals[1].type).toBe("Bool");
  expect(result.goalIds).toEqual([0, 1]);
});

test("load with type error in DisplayInfo Error → success=false", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: { kind: "Error", message: "Nat !=< Bool" },
    },
  ]);
  expect(result.success).toBe(false);
  expect(result.errors.length).toBe(1);
  expect(result.errors[0].includes("Nat")).toBeTruthy();
});

test("load with errors in AllGoalsWarnings.errors → success=false", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: 0, type: "?" }],
        invisibleGoals: [],
        errors: [{ range: {}, message: "Unsolved constraints" }],
        warnings: [],
      },
    },
  ]);
  expect(result.success).toBe(false);
  expect(result.errors.length > 0).toBeTruthy();
  expect(result.errors[0].includes("Unsolved")).toBeTruthy();
});

test("warnings extracted from AllGoalsWarnings.warnings", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [{ range: {}, message: "unreachable clause" }],
      },
    },
  ]);
  expect(result.success).toBe(true);
  expect(result.warnings.length > 0).toBeTruthy();
  expect(result.warnings[0].includes("unreachable")).toBeTruthy();
});

test("visibleGoals cross-fills goals missing from InteractionPoints", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: 5, type: "Nat" }],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  expect(result.goals.length).toBe(1);
  expect(result.goals[0].goalId).toBe(5);
  expect(result.goals[0].type).toBe("Nat");
  expect(result.goalIds).toEqual([5]);
});

test("invisibleGoals (abstract blocks) tracked", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [{ constraintObj: 3, type: "Nat → Nat" }],
        errors: [],
        warnings: [],
      },
    },
  ]);
  expect(result.invisibleGoalCount).toBe(1);
});

test("stderr error sets success=false", () => {
  const result = parseLoadResponses([
    { kind: "StderrOutput", text: "Fatal Error: cannot find module" },
  ]);
  expect(result.success).toBe(false);
  expect(result.errors.length > 0).toBeTruthy();
});

test("goalIds returned for atomic session assignment", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [0, 1] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [
          { constraintObj: 0, type: "Nat" },
          { constraintObj: 1, type: "Bool" },
        ],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  expect(result.goalIds).toEqual([0, 1]);
});

// ── §1.4: lastCheckedLine extraction ────────────────────────────

test("extractEarliestErrorLine: column-suffixed location", () => {
  expect(
    extractEarliestErrorLine(["/repo/src/File.agda:123:5: error: Nat is not a sort"]),
  ).toBe(123);
});

test("extractEarliestErrorLine: column-range location", () => {
  expect(
    extractEarliestErrorLine(["/repo/src/File.agda:42,7-12\nBlah blah"]),
  ).toBe(42);
});

test("extractEarliestErrorLine: literate Agda variant", () => {
  expect(
    extractEarliestErrorLine(["docs/Module.lagda.md:10,3-8: parse error"]),
  ).toBe(10);
});

test("extractEarliestErrorLine: picks the smallest line across multiple messages", () => {
  expect(
    extractEarliestErrorLine([
      "/repo/src/A.agda:300: late error",
      "/repo/src/A.agda:50,1-5: earlier error",
      "/repo/src/A.agda:150: middle error",
    ]),
  ).toBe(50);
});

test("extractEarliestErrorLine: ignores non-Agda paths", () => {
  expect(
    extractEarliestErrorLine([
      "./tooling/scripts/run-pinned-agda.sh:12: shell error",
      "/repo/src/Real.agda:77: actual error",
    ]),
  ).toBe(77);
});

test("extractEarliestErrorLine: returns null when no location matches", () => {
  expect(extractEarliestErrorLine(["just a plain sentence", "no file here"])).toBeNull();
});

test("extractEarliestErrorLine: returns null for empty input", () => {
  expect(extractEarliestErrorLine([])).toBeNull();
});

test("extractEarliestErrorLine: ignores zero and negative line numbers", () => {
  expect(
    extractEarliestErrorLine([
      "/repo/src/A.agda:0: nonsense line number",
      "/repo/src/A.agda:42: real location",
    ]),
  ).toBe(42);
});

test("extractEarliestErrorLine: tolerates malformed entries mixed with strings", () => {
  expect(
    extractEarliestErrorLine([
      null as unknown as string,
      undefined as unknown as string,
      42 as unknown as string,
      "/repo/src/A.agda:99: real",
    ]),
  ).toBe(99);
});

test("parseLoadResponses: lastCheckedLine extracted from stderr error with file:line", () => {
  const result = parseLoadResponses([
    {
      kind: "StderrOutput",
      text: "/repo/src/Broken.agda:156:12-35: error: ConstructorDoesNotFitInData",
    },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
  ]);
  expect(result.lastCheckedLine).toBe(156);
  expect(result.success).toBe(false);
});

test("parseLoadResponses: lastCheckedLine pulls the smallest line across errors and warnings", () => {
  const result = parseLoadResponses([
    {
      kind: "StderrOutput",
      text: "/repo/src/File.agda:300:1: error: something",
    },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: ["/repo/src/File.agda:50,1-4: error: earlier"],
        warnings: ["/repo/src/File.agda:200: deprecated"],
      },
    },
  ]);
  expect(result.lastCheckedLine).toBe(50);
});

test("parseLoadResponses: lastCheckedLine null on clean load", () => {
  const result = parseLoadResponses([
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ]);
  expect(result.lastCheckedLine ?? null).toBeNull();
});
