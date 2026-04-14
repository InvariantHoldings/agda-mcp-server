// Integration test for the v0.6.5 fix to `agda_constraints` on Agda 2.9.0.
//
// Agda 2.9.0 added a Rewrite-mode argument to `Cmd_constraints`; the bare
// form that worked through 2.8.0 is rejected with `cannot read:` on 2.9.0+.
// We pin a 2.9.0 binary in `.cache/agda/2.9.0/bin/agda` so this test runs
// against the version where the breakage was actually observed, regardless
// of which Agda is on PATH for the rest of the integration suite.

import { test, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { AgdaSession } from "../../../src/agda-process.js";

const PINNED_AGDA_2_9_0 = resolve(
  import.meta.dirname,
  "../../../.cache/agda/2.9.0/bin/agda",
);

const shouldRun = existsSync(PINNED_AGDA_2_9_0);
const it = shouldRun ? test : test.skip;

it("agda_constraints succeeds on Agda 2.9.0 with the rewrite-mode form", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-constraints-2-9-0-"));
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
  process.env.AGDA_BIN = PINNED_AGDA_2_9_0;
  // Point AGDA_DIR at the test root so a stray system library config
  // doesn't surface a LibraryError that masks the real protocol behaviour.
  process.env.AGDA_DIR = root;

  const session = new AgdaSession(root);
  try {
    const load = await session.load("Probe.agda");
    if (!load.success) {
      throw new Error(
        `Probe.agda failed to load on pinned 2.9.0: classification=${load.classification} errors=${JSON.stringify(load.errors)}`,
      );
    }
    expect(load.classification).toBe("ok-complete");

    // Trigger version detection so the inline pre-flight populates
    // `getAgdaVersion()` before the constraints query runs.
    const version = session.getAgdaVersion();
    expect(version).not.toBeNull();
    expect(version!.parts.slice(0, 2)).toEqual([2, 9]);

    // The actual regression: pre-fix this would throw a `tool-error`
    // with `cannot read: IOTCM ... (Cmd_constraints)`. Post-fix it
    // returns an empty (or empty-text) constraint list since Probe.agda
    // has no unsolved constraints.
    const result = await session.query.constraints();
    expect(typeof result.text).toBe("string");
    // No constraints in a fully-loaded file: text is "" (constraintsInfoSchema
    // returns an empty join when the array is empty).
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
