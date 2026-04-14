// Integration test for the v0.6.5 constraints fix on Agda 2.8.0.
//
// Complements agda-constraints-2-9-0.test.ts: that test pins the new
// `Cmd_constraints Normalised` protocol shape on the 2.9.0+ binary;
// this one pins the bare `Cmd_constraints` form we must keep working
// on 2.8.0 and earlier. Together they exercise both branches of
// `buildConstraintsCommand`'s version gate end-to-end, not just in
// the unit test.
//
// The binary path points at the Homebrew-installed agda so
// contributors who have agda 2.8.x on PATH via Homebrew already have
// this test enabled; the test self-skips when the binary isn't there.
// CI enables it via RUN_AGDA_INTEGRATION=1 when the Homebrew agda is
// the one installed on the runner.

import { test, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";

const SYSTEM_AGDA_2_8 = "/opt/homebrew/bin/agda";

function systemAgdaIs2_8_x(): boolean {
  if (!existsSync(SYSTEM_AGDA_2_8)) return false;
  try {
    const output = execFileSync(SYSTEM_AGDA_2_8, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      shell: false,
    });
    // We only want this test to run when the system Agda is actually
    // 2.8.x — if it's been upgraded to 2.9.x the 2.9.0 integration test
    // already covers it and this one would be a redundant duplicate.
    return /^Agda version 2\.8(\.|$)/mu.test(output);
  } catch {
    return false;
  }
}

const shouldRun = systemAgdaIs2_8_x();
const it = shouldRun ? test : test.skip;

it("agda_constraints succeeds on Agda 2.8.0 with the bare form", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-constraints-2-8-0-"));
  writeFileSync(
    resolve(root, "Probe.agda"),
    [
      "module Probe where",
      "",
      "data Nat : Set where",
      "  zero : Nat",
      "  suc  : Nat → Nat",
      "",
      "id : {A : Set} → A → A",
      "id x = x",
      "",
      "probe : Nat",
      "probe = id zero",
      "",
    ].join("\n"),
    "utf8",
  );

  const previousAgdaBin = process.env.AGDA_BIN;
  const previousAgdaDir = process.env.AGDA_DIR;
  process.env.AGDA_BIN = SYSTEM_AGDA_2_8;
  // Point AGDA_DIR at the test root so a stray system library config
  // doesn't surface a LibraryError that masks the real protocol behaviour.
  process.env.AGDA_DIR = root;

  const session = new AgdaSession(root);
  try {
    const load = await session.load("Probe.agda");
    if (!load.success) {
      throw new Error(
        `Probe.agda failed to load on Agda 2.8.0: classification=${load.classification} errors=${JSON.stringify(load.errors)}`,
      );
    }
    expect(load.classification).toBe("ok-complete");

    const version = session.getAgdaVersion();
    expect(version).not.toBeNull();
    expect(version!.parts.slice(0, 2)).toEqual([2, 8]);

    // On 2.8.0 the command must be `Cmd_constraints` (bare). If the
    // gate accidentally sends `Cmd_constraints Normalised` here, Agda
    // 2.8.0 replies with `cannot read: IOTCM ... (Cmd_constraints Normalised)`
    // on stdout and `throwOnFatalProtocolStderr` raises a tool-error.
    // So this test is effectively a regression guard for the <2.9.0
    // branch of `buildConstraintsCommand`.
    const result = await session.query.constraints();
    expect(typeof result.text).toBe("string");
    expect(result.text).toBe("");
  } finally {
    session.destroy();
    if (previousAgdaBin === undefined) {
      delete process.env.AGDA_BIN;
    } else {
      process.env.AGDA_BIN = previousAgdaBin;
    }
    if (previousAgdaDir === undefined) {
      delete process.env.AGDA_DIR;
    } else {
      process.env.AGDA_DIR = previousAgdaDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
