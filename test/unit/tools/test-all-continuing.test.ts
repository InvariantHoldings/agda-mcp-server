import { test, expect } from "vitest";

import {
  buildTestRunPlan,
  formatRunSummary,
  getTestLogPaths,
  isHighSignalLine,
} from "../../../scripts/test-all-continuing.mjs";

test("buildTestRunPlan covers build and all test groups", () => {
  expect(
    buildTestRunPlan().map((step) => step.label),
  ).toEqual(["build", "examples", "unit", "property", "integration"]);
});

test("formatRunSummary reports passing runs", () => {
  const summary = formatRunSummary([
    { label: "build", exitCode: 0 },
    { label: "integration", exitCode: 0 },
  ]);

  expect(summary).toMatch(/PASS build \(exit 0\)/);
  expect(summary).toMatch(/PASS integration \(exit 0\)/);
  expect(summary).toMatch(/PASSED: all/);
});

test("formatRunSummary reports failures without hiding later groups", () => {
  const summary = formatRunSummary([
    { label: "build", exitCode: 0 },
    { label: "unit", exitCode: 1 },
    { label: "integration", exitCode: 0 },
  ]);

  expect(summary).toMatch(/FAIL unit \(exit 1\)/);
  expect(summary).toMatch(/PASS integration \(exit 0\)/);
  expect(summary).toMatch(/FAILED: 1 group\(s\) failed/);
});

test("getTestLogPaths uses stable defaults", () => {
  expect(
    getTestLogPaths({}),
  ).toEqual({
    logDir: "test-output",
    verbosePath: "test-output/integration.verbose.log",
    quietPath: "test-output/integration.quiet.log",
  });
});

test("isHighSignalLine keeps failures, warnings, and summaries", () => {
  // vitest markers
  expect(isHighSignalLine(" ✓ test/unit/foo.test.ts (3 tests) 12ms")).toBe(true);
  expect(isHighSignalLine(" ✗ test/unit/bar.test.ts (1 failed)")).toBe(true);
  expect(isHighSignalLine(" FAIL  test/unit/bar.test.ts > my test")).toBe(true);
  expect(isHighSignalLine(" Test Files  2 passed | 1 failed (3)")).toBe(true);
  expect(isHighSignalLine(" Tests  10 passed (10)")).toBe(true);
  expect(isHighSignalLine(" Duration  1.23s")).toBe(true);
  // legacy / generic
  expect(isHighSignalLine("✖ failed thing")).toBe(true);
  expect(isHighSignalLine("sendCommand timed out")).toBe(true);
  expect(isHighSignalLine("ℹ fail 1")).toBe(true);
  expect(isHighSignalLine("PASS integration (exit 0)")).toBe(true);
  // noise
  expect(isHighSignalLine("✔ a passing test")).toBe(false);
  expect(isHighSignalLine("")).toBe(false);
});
