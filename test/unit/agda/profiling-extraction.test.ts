import { test, expect } from "vitest";

import { extractProfilingOutput } from "../../../src/agda/parse-load-responses.js";
import type { AgdaResponse } from "../../../src/agda/types.js";

// ── No profiling data ────────────────────────────────────────────────

test("returns null when no profiling responses are present", () => {
  const responses: AgdaResponse[] = [
    { kind: "InteractionPoints", interactionPoints: [] },
    { kind: "Status", checked: true },
  ];
  expect(extractProfilingOutput(responses)).toBeNull();
});

test("returns null for empty response array", () => {
  expect(extractProfilingOutput([])).toBeNull();
});

test("returns null when DisplayInfo has non-Time kind", () => {
  const responses: AgdaResponse[] = [
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
  ];
  expect(extractProfilingOutput(responses)).toBeNull();
});

// ── DisplayInfo with Time kind ───────────────────────────────────────

test("extracts profiling from DisplayInfo with Time kind and message", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "Total: 1.23s (type-checking) / 0.45s (scope checking)",
      },
    },
  ];
  const result = extractProfilingOutput(responses);
  expect(result).toBe("Total: 1.23s (type-checking) / 0.45s (scope checking)");
});

test("extracts profiling from DisplayInfo with Time kind and cpuTime", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        cpuTime: 2.5,
      },
    },
  ];
  const result = extractProfilingOutput(responses);
  expect(result).toBe("2.5");
});

test("prefers message over cpuTime in Time DisplayInfo", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "detailed timing info",
        cpuTime: 1.0,
      },
    },
  ];
  const result = extractProfilingOutput(responses);
  expect(result).toBe("detailed timing info");
});

test("falls back to cpuTime when message is empty string", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "",
        cpuTime: 3.14,
      },
    },
  ];
  const result = extractProfilingOutput(responses);
  expect(result).toBe("3.14");
});

test("falls back to cpuTime when message is whitespace-only", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "   ",
        cpuTime: 2.0,
      },
    },
  ];
  const result = extractProfilingOutput(responses);
  expect(result).toBe("2");
});

// ── RunningInfo responses ────────────────────────────────────────────

test("extracts profiling from RunningInfo with message", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "RunningInfo",
      message: "Checking module A...",
    },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("Checking module A...");
});

test("extracts profiling from RunningInfo with text field", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "RunningInfo",
      text: "Module A: 0.5s",
    },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("Module A: 0.5s");
});

test("falls back to text when RunningInfo message is empty string", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "RunningInfo",
      message: "",
      text: "Module B: 1.0s",
    },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("Module B: 1.0s");
});

test("falls back to text when RunningInfo message is whitespace-only", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "RunningInfo",
      message: "  ",
      text: "actual profiling data",
    },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("actual profiling data");
});

// ── Multiple profiling responses combine ─────────────────────────────

test("combines multiple RunningInfo messages with newlines", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Checking A..." },
    { kind: "RunningInfo", message: "Checking B..." },
    { kind: "RunningInfo", message: "Done." },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("Checking A...\nChecking B...\nDone.");
});

test("combines RunningInfo and DisplayInfo Time responses", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Module profiling data" },
    { kind: "InteractionPoints", interactionPoints: [0] },
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "Total: 2.0s",
      },
    },
    { kind: "Status", checked: true },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("Module profiling data\nTotal: 2.0s");
});

// ── Empty profiling fields ───────────────────────────────────────────

test("skips RunningInfo with empty message", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "" },
    { kind: "RunningInfo", message: "real data" },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("real data");
});

test("returns null when Time DisplayInfo has empty message and no cpuTime", () => {
  const responses: AgdaResponse[] = [
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "",
      },
    },
  ];
  expect(extractProfilingOutput(responses)).toBeNull();
});

// ── Mixed with non-profiling responses ───────────────────────────────

test("ignores non-profiling responses and extracts only profiling data", () => {
  const responses: AgdaResponse[] = [
    { kind: "InteractionPoints", interactionPoints: [0, 1] },
    { kind: "RunningInfo", message: "profile data here" },
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
        kind: "Error",
        message: "some error",
      },
    },
    { kind: "Status", checked: true },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: true });
  expect(result).toBe("profile data here");
});

// ── RunningInfo gating ───────────────────────────────────────────────

test("ignores RunningInfo when profilingEnabled is false (default)", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "Checking Module..." },
  ];
  expect(extractProfilingOutput(responses)).toBeNull();
  expect(extractProfilingOutput(responses, { profilingEnabled: false })).toBeNull();
});

test("still extracts DisplayInfo/Time when profilingEnabled is false", () => {
  const responses: AgdaResponse[] = [
    { kind: "RunningInfo", message: "progress message" },
    {
      kind: "DisplayInfo",
      info: {
        kind: "Time",
        message: "Total: 1.0s",
      },
    },
  ];
  const result = extractProfilingOutput(responses, { profilingEnabled: false });
  expect(result).toBe("Total: 1.0s");
});
