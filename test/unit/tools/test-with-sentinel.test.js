import test from "node:test";
import assert from "node:assert/strict";

import { formatSentinelMessage } from "../../../scripts/test-with-sentinel.mjs";

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
