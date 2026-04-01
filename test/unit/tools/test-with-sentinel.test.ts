import { test, expect } from "vitest";

import { formatSentinelMessage, isMainModule } from "../../../scripts/test-with-sentinel.mjs";

test("formatSentinelMessage emits PASSED for zero exit code", () => {
  expect(
    formatSentinelMessage({ label: "expression parity", exitCode: 0 }),
  ).toBe("PASSED: expression parity");
});

test("formatSentinelMessage emits FAILED for non-zero exit code", () => {
  expect(
    formatSentinelMessage({ label: "expression parity", exitCode: 2 }),
  ).toBe("FAILED: expression parity (exit code 2)");
});

test("isMainModule compares module URLs portably", () => {
  expect(
    isMainModule("file:///tmp/scripts/test-with-sentinel.mjs", "/tmp/scripts/test-with-sentinel.mjs"),
  ).toBe(true);
  expect(
    isMainModule("file:///tmp/scripts/test-with-sentinel.mjs", "/tmp/scripts/other.mjs"),
  ).toBe(false);
});
