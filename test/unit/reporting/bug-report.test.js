import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBugReportBundle,
  fingerprintBugReport,
} from "../../../dist/reporting/bug-report.js";

test("fingerprintBugReport is stable for equivalent semantic payloads", () => {
  const first = fingerprintBugReport({
    kind: "new-bug",
    affectedTool: "agda_load",
    classification: "ok-with-holes",
    observed: "agda_load returned zero goals",
    expected: "agda_load should surface interaction points",
    reproduction: ["load WithHoles.agda", "inspect goalIds"],
    diagnostics: [
      { severity: "error", code: "goal-missing", message: "No goals returned" },
    ],
    toolPayload: { goalCount: 0, goalIds: [] },
    serverVersion: "0.6.1",
  });

  const second = fingerprintBugReport({
    kind: "new-bug",
    affectedTool: "agda_load",
    classification: "ok-with-holes",
    observed: "agda_load returned zero goals",
    expected: "agda_load should surface interaction points",
    reproduction: ["load WithHoles.agda", "inspect goalIds"],
    diagnostics: [
      { message: "No goals returned", severity: "error", code: "goal-missing" },
    ],
    toolPayload: { goalIds: [], goalCount: 0 },
    serverVersion: "0.6.1",
  });

  assert.equal(first, second);
});

test("buildBugReportBundle includes deterministic fingerprint and defaults", () => {
  const bundle = buildBugReportBundle({
    kind: "update",
    existingIssue: 4,
    affectedTool: "agda_load",
    classification: "ok-with-holes",
    observed: "interactive tools fail because no goals are exposed",
    expected: "agda_load should populate goal IDs",
    reproduction: ["run agda_load", "call agda_goal_type"],
    diagnostics: [],
    evidence: { goalCount: 0 },
    serverVersion: "0.6.1",
  });

  assert.equal(bundle.kind, "update");
  assert.equal(bundle.existingIssue, 4);
  assert.match(bundle.bugFingerprint, /^[0-9a-f]{16}$/);
  assert.equal(bundle.title, "update issue #4: agda_load ok-with-holes");
});
