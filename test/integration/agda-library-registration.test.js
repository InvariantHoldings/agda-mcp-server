import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgdaSession, typeCheckBatch } from "../../dist/agda-process.js";

let agdaAvailable = false;
try {
  execSync("agda --version", { stdio: "pipe" });
  agdaAvailable = true;
} catch {
  // Agda not in PATH
}

const it = agdaAvailable && process.env.RUN_AGDA_INTEGRATION === "1"
  ? test
  : test.skip;

it("project library registration remains symmetric with batch mode under broken AGDA_DIR", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-lib-project-"));
  const agdaDir = mkdtempSync(join(tmpdir(), "agda-mcp-broken-appdir-"));
  const previousAgdaDir = process.env.AGDA_DIR;

  try {
    mkdirSync(join(repoRoot, "lib"), { recursive: true });

    writeFileSync(join(repoRoot, "project.agda-lib"), "name: project\ninclude: lib\n", "utf8");
    writeFileSync(join(repoRoot, "lib", "Dep.agda"), [
      "module Dep where",
      "",
      "open import Agda.Builtin.Nat",
      "",
      "x : Nat",
      "x = 0",
      "",
    ].join("\n"), "utf8");
    writeFileSync(join(repoRoot, "lib", "Main.agda"), [
      "module Main where",
      "",
      "open import Agda.Builtin.Nat",
      "open import Dep",
      "",
      "answer : Nat",
      "answer = x",
      "",
    ].join("\n"), "utf8");

    writeFileSync(join(agdaDir, "libraries"), `${join(agdaDir, "missing.agda-lib")}\n`, "utf8");
    writeFileSync(join(agdaDir, "defaults"), "missing\n", "utf8");
    process.env.AGDA_DIR = agdaDir;

    const session = new AgdaSession(repoRoot);
    try {
      const load = await session.load("lib/Main.agda");
      assert.equal(load.success, true, load.errors.join("\n"));
      assert.deepEqual(load.errors, []);
    } finally {
      session.destroy();
    }

    const batch = await typeCheckBatch("lib/Main.agda", repoRoot);
    assert.equal(batch.success, true, batch.errors.join("\n"));
    assert.deepEqual(batch.errors, []);
  } finally {
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }

    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(agdaDir, { recursive: true, force: true });
  }
});
