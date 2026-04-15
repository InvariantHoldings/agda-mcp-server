import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";
import { withIsolatedAgdaDir } from "../../helpers/isolated-agda-dir.js";

const shouldRun = process.env.RUN_AGDA_BACKEND_INTEGRATION === "1";
const backendExpr = process.env.AGDA_BACKEND_EXPR ?? "GHC";
const canRun = shouldRun && hasAgdaBinary();

function hasAgdaBinary() {
  const result = spawnSync("agda", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

const it = canRun ? test : test.skip;

it("backend commands run against a live Agda session", async () => {
  await withIsolatedAgdaDir(async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-backend-it-"));
    const noHolePath = join(repoRoot, "BackendNoHole.agda");
    const holePath = join(repoRoot, "BackendHole.agda");

    writeFileSync(
      noHolePath,
      [
        "module BackendNoHole where",
        "",
        "open import Agda.Builtin.Nat using (Nat)",
        "",
        "idNat : Nat -> Nat",
        "idNat x = x",
      ].join("\n"),
      "utf8",
    );

    writeFileSync(
      holePath,
      [
        "module BackendHole where",
        "",
        "open import Agda.Builtin.Nat using (Nat)",
        "",
        "demo : Nat -> Nat",
        "demo x = {!!}",
      ].join("\n"),
      "utf8",
    );

    const session = new AgdaSession(repoRoot);

    try {
      const compileResult = await session.compile(backendExpr, noHolePath, []);
      expect(typeof compileResult.success).toBe("boolean");
      expect(typeof compileResult.output).toBe("string");

      const loadResult = await session.load(holePath);
      expect(loadResult.success).toBe(true);

      const topResult = await session.backendTop(backendExpr, "ping");
      expect(typeof topResult.success).toBe("boolean");
      expect(typeof topResult.output).toBe("string");

      if (loadResult.goals.length > 0) {
        const goalId = loadResult.goals[0].goalId;
        const holeResult = await session.backendHole(goalId, "", backendExpr, "ping-hole");
        expect(typeof holeResult.success).toBe("boolean");
        expect(typeof holeResult.output).toBe("string");
      }
    } finally {
      session.destroy();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
