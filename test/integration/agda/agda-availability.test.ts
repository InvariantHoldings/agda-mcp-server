import { test, expect } from "vitest";
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

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Agda/i);
  },
);
