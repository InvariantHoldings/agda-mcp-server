import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";

const shouldRun = process.env.RUN_AGDA_INTEGRATION === "1";

const it = shouldRun ? test : test.skip;

it("agda is available for integration tests", () => {
    const result = spawnSync("agda", ["--version"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Agda/i);
  });
