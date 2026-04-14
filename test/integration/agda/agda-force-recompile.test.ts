// Integration test for the v0.6.5 `forceRecompile` escape hatch.
//
// Verifies end-to-end against the pinned Agda 2.9.0 binary that:
//   1. A normal load populates the separated `_build/2.9.0/agda/Probe.agdai` artifact.
//   2. A subsequent `agda_load` with `forceRecompile: true` deletes that
//      artifact before sending Cmd_load.
//   3. After the recompile, the artifact reappears (Agda rebuilt it).
// The test self-skips when `.cache/agda/2.9.0/bin/agda` is not present.

import { test, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { AgdaSession } from "../../../src/agda-process.js";
import { findAgdaiArtifacts, bustAgdaiCache } from "../../../src/agda/agdai-cache.js";

const PINNED_AGDA_2_9_0 = resolve(
  import.meta.dirname,
  "../../../.cache/agda/2.9.0/bin/agda",
);

const shouldRun = existsSync(PINNED_AGDA_2_9_0);
const it = shouldRun ? test : test.skip;

it("forceRecompile busts the .agdai cache and Agda rebuilds it on reload", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-force-recompile-"));
  // Set up a tiny project with an .agda-lib so Agda uses the
  // separated-interface layout (which is the harder case to validate).
  writeFileSync(
    resolve(root, "probe.agda-lib"),
    "name: probe\ninclude: .\n",
  );
  writeFileSync(
    resolve(root, "Probe.agda"),
    [
      "module Probe where",
      "",
      "data Bool : Set where",
      "  true false : Bool",
      "",
      "flip : Bool → Bool",
      "flip true = false",
      "flip false = true",
      "",
    ].join("\n"),
    "utf8",
  );

  const previousAgdaBin = process.env.AGDA_BIN;
  const previousAgdaDir = process.env.AGDA_DIR;
  process.env.AGDA_BIN = PINNED_AGDA_2_9_0;
  process.env.AGDA_DIR = root;

  const session = new AgdaSession(root);
  try {
    // ── 1. first load populates the cache ─────────────────────────
    const firstLoad = await session.load("Probe.agda");
    if (!firstLoad.success) {
      throw new Error(`Probe.agda failed initial load: ${JSON.stringify(firstLoad.errors)}`);
    }
    expect(firstLoad.classification).toBe("ok-complete");

    const afterFirstLoad = findAgdaiArtifacts(resolve(root, "Probe.agda"), root);
    expect(afterFirstLoad.length).toBeGreaterThanOrEqual(1);
    const separated = afterFirstLoad.find((a) => a.kind === "separated");
    expect(separated, "expected a separated _build artifact").toBeDefined();
    expect(separated!.agdaVersion).toBe("2.9.0");
    expect(existsSync(separated!.path)).toBe(true);

    // ── 2. busting deletes it ─────────────────────────────────────
    const busted = bustAgdaiCache(resolve(root, "Probe.agda"), root);
    expect(busted).toContain(separated!.path);
    expect(existsSync(separated!.path)).toBe(false);

    // ── 3. reload recompiles and the cache reappears ──────────────
    const secondLoad = await session.load("Probe.agda");
    if (!secondLoad.success) {
      throw new Error(`Probe.agda failed second load: ${JSON.stringify(secondLoad.errors)}`);
    }
    const afterSecondLoad = findAgdaiArtifacts(resolve(root, "Probe.agda"), root);
    expect(afterSecondLoad.find((a) => a.kind === "separated"), "expected the separated artifact to be rebuilt").toBeDefined();
  } finally {
    session.destroy();
    if (previousAgdaBin === undefined) delete process.env.AGDA_BIN;
    else process.env.AGDA_BIN = previousAgdaBin;
    if (previousAgdaDir === undefined) delete process.env.AGDA_DIR;
    else process.env.AGDA_DIR = previousAgdaDir;
    rmSync(root, { recursive: true, force: true });
  }
});
