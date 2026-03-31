import test from "node:test";
import assert from "node:assert/strict";

import { formatSentinelMessage, isMainModule } from "../../../scripts/test-with-sentinel.mjs";

test("formatSentinelMessage emits PASSED for zero exit code", () => {
  assert.equal(
    formatSentinelMessage({ label: "expression parity", exitCode: 0 }),
    "PASSED: expression parity",
  );
});

test("formatSentinelMessage emits FAILED for non-zero exit code", () => {
  assert.equal(
    formatSentinelMessage({ label: "expression parity", exitCode: 2 }),
    "FAILED: expression parity (exit code 2)",
  );
});

test("isMainModule compares module URLs portably", () => {
  assert.equal(
    isMainModule("file:///tmp/scripts/test-with-sentinel.mjs", "/tmp/scripts/test-with-sentinel.mjs"),
    true,
  );
  assert.equal(
    isMainModule("file:///tmp/scripts/test-with-sentinel.mjs", "/tmp/scripts/other.mjs"),
    false,
  );
});
