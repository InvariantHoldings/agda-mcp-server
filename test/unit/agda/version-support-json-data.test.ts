// MIT License — see LICENSE
//
// Tests for the JSON-backed data files in src/agda/data/.
// Verifies that the JSON files load correctly and that the data
// they contain matches the expected values from version-support.ts.

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  supportedSourceExtensions,
  allSourceExtensionSuffixes,
  allFeatureFlagNames,
  supportsFeatureFlag,
  isAgdaSourceFile,
} from "../../../src/agda/version-support.js";
import { parseAgdaVersion } from "../../../src/agda/agda-version.js";

const DATA_DIR = resolve(import.meta.dirname, "../../../src/agda/data");

// ── Raw JSON file structure tests ──────────────────────────────────

test("agda-source-extensions.json is valid JSON with expected shape", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-source-extensions.json"), "utf8")) as unknown[];

  expect(Array.isArray(raw)).toBe(true);
  expect((raw as Array<{ suffix: string }>).every((entry) => typeof entry.suffix === "string")).toBe(true);

  // Every entry with a minVersion has a parseable version string
  for (const entry of raw as Array<{ suffix: string; minVersion?: string }>) {
    if (entry.minVersion !== undefined) {
      expect(() => parseAgdaVersion(entry.minVersion!)).not.toThrow();
    }
  }
});

test("agda-feature-flags.json is valid JSON with expected shape", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-feature-flags.json"), "utf8")) as unknown[];

  expect(Array.isArray(raw)).toBe(true);
  expect((raw as Array<{ flag: string; minVersion: string }>).every(
    (entry) => typeof entry.flag === "string" && typeof entry.minVersion === "string",
  )).toBe(true);

  // Every minVersion is parseable
  for (const entry of raw as Array<{ flag: string; minVersion: string }>) {
    expect(() => parseAgdaVersion(entry.minVersion)).not.toThrow();
  }
});

// ── Content invariants ─────────────────────────────────────────────

test("agda-source-extensions.json contains exactly 8 entries", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-source-extensions.json"), "utf8")) as unknown[];
  expect(raw.length).toBe(8);
});

test("agda-source-extensions.json starts with .agda (no minVersion)", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-source-extensions.json"), "utf8")) as Array<{ suffix: string; minVersion?: string }>;
  const first = raw[0];
  expect(first.suffix).toBe(".agda");
  expect(first.minVersion).toBeUndefined();
});

test("agda-source-extensions.json suffixes are unique", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-source-extensions.json"), "utf8")) as Array<{ suffix: string }>;
  const suffixes = raw.map((e) => e.suffix);
  expect(new Set(suffixes).size).toBe(suffixes.length);
});

test("agda-feature-flags.json flags are unique and start with --", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-feature-flags.json"), "utf8")) as Array<{ flag: string }>;
  const flags = raw.map((e) => e.flag);

  expect(new Set(flags).size).toBe(flags.length);
  for (const flag of flags) {
    expect(flag.startsWith("--")).toBe(true);
  }
});

// ── Round-trip: JSON data feeds the same functions as before ───────

test("allSourceExtensionSuffixes() returns all 8 extensions", () => {
  const suffixes = allSourceExtensionSuffixes();
  expect(suffixes.length).toBe(8);
  expect(suffixes).toContain(".agda");
  expect(suffixes).toContain(".lagda.md");
  expect(suffixes).toContain(".lagda.tree");
});

test("allFeatureFlagNames() returns all 8 known flags", () => {
  const flags = allFeatureFlagNames();
  expect(flags.length).toBe(8);
  expect(flags).toContain("--cubical");
  expect(flags).toContain("--sized-types");
  expect(flags).toContain("--erasure");
});

test("supportedSourceExtensions() with no version returns all from JSON", () => {
  const exts = supportedSourceExtensions();
  const allFromJson = allSourceExtensionSuffixes();

  // Every suffix in the JSON must be returned when no version filter is applied
  for (const suffix of allFromJson) {
    expect(exts).toContain(suffix);
  }
  expect(exts.length).toBe(allFromJson.length);
});

test("supportsFeatureFlag unknown flag returns true (let Agda decide)", () => {
  const v = parseAgdaVersion("2.6.0");
  expect(supportsFeatureFlag("--some-future-flag-not-in-json", v)).toBe(true);
});

test("all flags from JSON are gated correctly by their recorded minVersion", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-feature-flags.json"), "utf8")) as Array<{ flag: string; minVersion: string }>;
  for (const { flag, minVersion } of raw) {
    const exactly = parseAgdaVersion(minVersion);
    expect(supportsFeatureFlag(flag, exactly)).toBe(true);
  }
});

test("all extensions from JSON are recognised by isAgdaSourceFile", () => {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, "agda-source-extensions.json"), "utf8")) as Array<{ suffix: string }>;
  for (const { suffix } of raw) {
    expect(isAgdaSourceFile(`Test${suffix}`)).toBe(true);
  }
});
