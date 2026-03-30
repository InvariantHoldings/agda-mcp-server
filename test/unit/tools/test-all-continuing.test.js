import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTestRunPlan,
  formatRunSummary,
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
