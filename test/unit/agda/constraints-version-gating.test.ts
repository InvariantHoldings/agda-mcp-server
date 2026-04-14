import { test, expect } from "vitest";

import { buildConstraintsCommand } from "../../../src/agda/advanced-queries.js";
import { parseAgdaVersion } from "../../../src/agda/agda-version.js";
import { hasConstraintsRewriteMode } from "../../../src/agda/version-support.js";

// ── version capability ──────────────────────────────────────────────

test("hasConstraintsRewriteMode is false on 2.7.0.1", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.7.0.1"))).toBe(false);
});

test("hasConstraintsRewriteMode is false on 2.8.0", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.8.0"))).toBe(false);
});

test("hasConstraintsRewriteMode is false on 2.8.1", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.8.1"))).toBe(false);
});

test("hasConstraintsRewriteMode is true on 2.9.0", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.9.0"))).toBe(true);
});

test("hasConstraintsRewriteMode is true on 2.9.1", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.9.1"))).toBe(true);
});

test("hasConstraintsRewriteMode is true on 3.0", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("3.0"))).toBe(true);
});

// 2.9.0-rc1 is a prerelease that sorts strictly below 2.9.0 — it's
// the boundary case where empirically the protocol shape changed.
// We treat it as 'not yet on the new shape' because the parser change
// landed for the GA release, not the rc.
test("hasConstraintsRewriteMode is false on 2.9.0-rc1 (prerelease sorts below 2.9.0)", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.9.0-rc1"))).toBe(false);
});

// ── command builder ────────────────────────────────────────────────

test("buildConstraintsCommand emits bare Cmd_constraints on 2.8.0", () => {
  const cmd = buildConstraintsCommand({
    getAgdaVersion: () => parseAgdaVersion("2.8.0"),
  });
  expect(cmd).toBe("Cmd_constraints");
});

test("buildConstraintsCommand emits Cmd_constraints Normalised on 2.9.0", () => {
  const cmd = buildConstraintsCommand({
    getAgdaVersion: () => parseAgdaVersion("2.9.0"),
  });
  expect(cmd).toBe("Cmd_constraints Normalised");
});

// When the version hasn't been detected yet, default to the newer
// shape: the next release of Agda is more likely to keep the rewrite
// mode than to remove it, and 2.9.0+ is what new installations get.
test("buildConstraintsCommand emits Cmd_constraints Normalised when version is unknown", () => {
  const cmd = buildConstraintsCommand({
    getAgdaVersion: () => null,
  });
  expect(cmd).toBe("Cmd_constraints Normalised");
});
