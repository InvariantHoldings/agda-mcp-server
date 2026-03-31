import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { AgdaSession } from "../../../dist/agda-process.js";

const shouldRun = process.env.RUN_AGDA_BACKEND_INTEGRATION === "1";
const backendExpr = process.env.AGDA_BACKEND_EXPR ?? "GHC";
const canRun = shouldRun && hasAgdaBinary();

function hasAgdaBinary() {
  const result = spawnSync("agda", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

test(
  "backend commands run against a live Agda session",
  {
    skip: canRun
      ? false
      : "Set RUN_AGDA_BACKEND_INTEGRATION=1 and ensure agda is in PATH to run backend integration tests.",
  },
  async () => {
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
      assert.equal(typeof compileResult.success, "boolean");
      assert.equal(typeof compileResult.output, "string");

      const loadResult = await session.load(holePath);
      assert.equal(loadResult.success, true);

      const topResult = await session.backendTop(backendExpr, "ping");
      assert.equal(typeof topResult.success, "boolean");
      assert.equal(typeof topResult.output, "string");

      if (loadResult.goals.length > 0) {
        const goalId = loadResult.goals[0].goalId;
        const holeResult = await session.backendHole(goalId, "", backendExpr, "ping-hole");
        assert.equal(typeof holeResult.success, "boolean");
        assert.equal(typeof holeResult.output, "string");
      }
    } finally {
      session.destroy();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  },
);
