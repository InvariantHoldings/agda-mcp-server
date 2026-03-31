import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTestRunPlan,
  formatRunSummary,
  getTestLogPaths,
  isHighSignalLine,
} from "../../../scripts/test-all-continuing.mjs";

test("buildTestRunPlan covers build and all test groups", () => {
  assert.deepEqual(
    buildTestRunPlan().map((step) => step.label),
    ["build", "examples", "unit", "property", "integration"],
  );
});

test("formatRunSummary reports passing runs", () => {
  const summary = formatRunSummary([
    { label: "build", exitCode: 0 },
    { label: "integration", exitCode: 0 },
  ]);

  assert.match(summary, /PASS build \(exit 0\)/);
  assert.match(summary, /PASS integration \(exit 0\)/);
  assert.match(summary, /PASSED: all/);
});

test("formatRunSummary reports failures without hiding later groups", () => {
  const summary = formatRunSummary([
    { label: "build", exitCode: 0 },
    { label: "unit", exitCode: 1 },
    { label: "integration", exitCode: 0 },
  ]);

  assert.match(summary, /FAIL unit \(exit 1\)/);
  assert.match(summary, /PASS integration \(exit 0\)/);
  assert.match(summary, /FAILED: 1 group\(s\) failed/);
});

test("getTestLogPaths uses stable defaults", () => {
  assert.deepEqual(
    getTestLogPaths({}),
    {
      logDir: "test-output",
      verbosePath: "test-output/integration.verbose.log",
      quietPath: "test-output/integration.quiet.log",
    },
  );
});

test("isHighSignalLine keeps failures, warnings, and summaries", () => {
  assert.equal(isHighSignalLine("✖ failed thing"), true);
  assert.equal(isHighSignalLine("sendCommand timed out"), true);
  assert.equal(isHighSignalLine("ℹ fail 1"), true);
  assert.equal(isHighSignalLine("PASS integration (exit 0)"), true);
  assert.equal(isHighSignalLine("✔ a passing test"), false);
  assert.equal(isHighSignalLine(""), false);
});
