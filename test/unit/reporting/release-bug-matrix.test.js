import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { releaseBugMatrix } from "../../fixtures/release-bug-matrix.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

test("release bug matrix tracks the 0.6.2 bug set uniquely", () => {
  const issues = releaseBugMatrix.map((entry) => entry.issue);

  assert.deepEqual(issues, [3, 4, 5, 7, 8]);
  assert.equal(new Set(issues).size, issues.length);
  assert.ok(releaseBugMatrix.every((entry) => entry.release === "0.6.2"));
});

test("release bug matrix references existing evidence files", () => {
  for (const entry of releaseBugMatrix) {
    for (const relativePath of [...entry.localEvidence, ...entry.liveSuites]) {
      assert.equal(
        existsSync(resolve(REPO_ROOT, relativePath)),
        true,
        `missing evidence file for issue #${entry.issue}: ${relativePath}`,
      );
    }
  }
});
