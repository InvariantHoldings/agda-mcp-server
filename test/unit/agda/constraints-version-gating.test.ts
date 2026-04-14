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

// Prerelease tags don't move the protocol shape: a 2.9.0-rc build
// is produced from the same codebase as the 2.9.0 release and
// therefore has the same IOTCM parser. The gate is a parser-identity
// question ("is this parser the new one?"), not a release-ordering
// question ("has the stable version shipped?"), so the prerelease
// must report `true` — sending the bare form to an rc would be
// rejected with the same `cannot read:` error as on the stable
// 2.9.0 release.
test("hasConstraintsRewriteMode is true on 2.9.0-rc1 (prerelease shares the 2.9 parser)", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.9.0-rc1"))).toBe(true);
});

test("hasConstraintsRewriteMode is true on 2.9.0-alpha", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.9.0-alpha"))).toBe(true);
});

// Symmetric case: a prerelease of 2.8 still has the OLD parser.
// The gate must NOT be fooled by the prerelease flag into treating
// 2.8.99-something as the new shape.
test("hasConstraintsRewriteMode is false on 2.8.99-nightly (prerelease of the old line)", () => {
  expect(hasConstraintsRewriteMode(parseAgdaVersion("2.8.99-nightly"))).toBe(false);
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
