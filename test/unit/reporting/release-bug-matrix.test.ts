import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { releaseBugMatrix } from "../../fixtures/release-bug-matrix.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

test("release bug matrix tracks the 0.6.2 bug set uniquely", () => {
  const issues = releaseBugMatrix.map((entry) => entry.issue);

  expect(issues).toEqual([3, 4, 5, 7, 8]);
  expect(new Set(issues).size).toBe(issues.length);
  expect(releaseBugMatrix.every((entry) => entry.release === "0.6.2")).toBeTruthy();
});

test("release bug matrix references existing evidence files", () => {
  for (const entry of releaseBugMatrix) {
    for (const relativePath of [...entry.localEvidence, ...entry.liveSuites]) {
      expect(
        existsSync(resolve(REPO_ROOT, relativePath)),
      ).toBe(true);
    }
  }
});
