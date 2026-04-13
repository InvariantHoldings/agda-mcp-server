import { test, expect } from "vitest";

import { parseLoadResponses } from "../../../src/agda/parse-load-responses.js";
import type { AgdaResponse } from "../../../src/agda/types.js";

// ── Profiling in parseLoadResponses ──────────────────────────────────

test("parseLoadResponses returns null profiling when no profiling responses", () => {
  const responses: AgdaResponse[] = [
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
  ];

  const result = parseLoadResponses(responses);
  expect(result.profiling).toBeNull();
});

test("parseLoadResponses includes profiling from DisplayInfo Time", () => {
  const responses: AgdaResponse[] = [
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
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "Total: 2.5s",
      },
    },
    { kind: "Status", checked: true },
  ];

  const result = parseLoadResponses(responses);
  expect(result.profiling).toBe("Total: 2.5s");
  expect(result.success).toBe(true);
});

test("parseLoadResponses includes profiling from RunningInfo", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Module A: 0.3s" },
    { kind: "RunningInfo", message: "Module B: 0.7s" },
    { kind: "InteractionPoints", interactionPoints: [0] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "AllGoalsWarnings",
        visibleGoals: [{ constraintObj: { id: 0 }, type: "?" }],
        invisibleGoals: [],
        errors: [],
        warnings: [],
      },
    },
    { kind: "Status", checked: true },
  ];

  const result = parseLoadResponses(responses, { profilingEnabled: true });
  expect(result.profiling).toBe("Module A: 0.3s\nModule B: 0.7s");
  expect(result.success).toBe(true);
  expect(result.goalIds).toEqual([0]);
});

test("parseLoadResponses combines RunningInfo and Time profiling", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Checking module..." },
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
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "Total: 1.0s",
      },
    },
    { kind: "Status", checked: true },
  ];

  const result = parseLoadResponses(responses, { profilingEnabled: true });
  expect(result.profiling).toBe("Checking module...\nTotal: 1.0s");
});

test("parseLoadResponses profiling does not affect success/error classification", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "profiling data" },
    { kind: "InteractionPoints", interactionPoints: [] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "Error",
        message: "Type error in module",
      },
    },
    { kind: "Status", checked: false },
  ];

  const result = parseLoadResponses(responses, { profilingEnabled: true });
  expect(result.success).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.profiling).toBe("profiling data");
});

test("parseLoadResponses ignores RunningInfo when profilingEnabled is false", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Checking Module..." },
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
  ];

  const result = parseLoadResponses(responses);
  expect(result.profiling).toBeNull();
});
