import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const shouldRun = process.env.RUN_AGDA_INTEGRATION === "1";

test(
  "agda is available for integration tests",
  {
    skip: shouldRun ? false : "Set RUN_AGDA_INTEGRATION=1 to enable Agda-backed integration tests.",
  },
  () => {
    const result = spawnSync("agda", ["--version"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout || "Failed to execute agda --version");
    assert.match(`${result.stdout}${result.stderr}`, /Agda/i);
  },
);
