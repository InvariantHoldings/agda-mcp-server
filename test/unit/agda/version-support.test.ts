import { test, expect } from "vitest";
import {
  parseAgdaVersion,
} from "../../../src/agda/agda-version.js";
import {
  isAgdaSourceFile,
  supportedSourceExtensions,
  supportsFeatureFlag,
  supportedFeatureFlags,
  hasStructuredGiveResult,
  filePathDescription,
} from "../../../src/agda/version-support.js";

const v250 = parseAgdaVersion("2.5.0");
const v253 = parseAgdaVersion("2.5.3");
const v260 = parseAgdaVersion("2.6.0");
const v261 = parseAgdaVersion("2.6.1");
const v270 = parseAgdaVersion("2.7.0");
const v290 = parseAgdaVersion("2.9.0");

// ── isAgdaSourceFile ────────────────────────────────────

test(".agda is always recognised", () => {
  expect(isAgdaSourceFile("Foo.agda")).toBe(true);
  expect(isAgdaSourceFile("Foo.agda", v250)).toBe(true);
});

test(".lagda.md recognised without version", () => {
  expect(isAgdaSourceFile("Foo.lagda.md")).toBe(true);
});

test(".lagda.md not recognised on Agda < 2.5.3", () => {
  expect(isAgdaSourceFile("Foo.lagda.md", v250)).toBe(false);
});

test(".lagda.md recognised on Agda >= 2.5.3", () => {
  expect(isAgdaSourceFile("Foo.lagda.md", v253)).toBe(true);
});

test(".lagda.org not recognised on Agda < 2.6.1", () => {
  expect(isAgdaSourceFile("Foo.lagda.org", v260)).toBe(false);
});

test(".lagda.org recognised on Agda >= 2.6.1", () => {
  expect(isAgdaSourceFile("Foo.lagda.org", v261)).toBe(true);
});

test(".lagda.tree not recognised on Agda < 2.7.0", () => {
  expect(isAgdaSourceFile("Foo.lagda.tree", v261)).toBe(false);
});

test(".lagda.tree recognised on Agda >= 2.7.0", () => {
  expect(isAgdaSourceFile("Foo.lagda.tree", v270)).toBe(true);
});

test("non-Agda files are rejected", () => {
  expect(isAgdaSourceFile("Foo.hs")).toBe(false);
  expect(isAgdaSourceFile("Foo.txt")).toBe(false);
  expect(isAgdaSourceFile("Foo.md")).toBe(false);
});

// ── supportedSourceExtensions ───────────────────────────

test("all 8 extensions returned without version", () => {
  expect(supportedSourceExtensions().length).toBe(8);
});

test("only .agda and .lagda for very old version", () => {
  const exts = supportedSourceExtensions(parseAgdaVersion("2.5.1"));
  expect(exts).toContain(".agda");
  expect(exts).toContain(".lagda");
  expect(exts).not.toContain(".lagda.md");
});

test("includes .lagda.md for 2.5.3+", () => {
  expect(supportedSourceExtensions(v253)).toContain(".lagda.md");
});

// ── supportsFeatureFlag ─────────────────────────────────

test("--cubical not supported before 2.6.0", () => {
  expect(supportsFeatureFlag("--cubical", v253)).toBe(false);
});

test("--cubical supported at 2.6.0", () => {
  expect(supportsFeatureFlag("--cubical", v260)).toBe(true);
});

test("--sized-types supported at 2.5.0", () => {
  expect(supportsFeatureFlag("--sized-types", v250)).toBe(true);
});

test("unknown flags are allowed (let Agda decide)", () => {
  expect(supportsFeatureFlag("--unknown-future-flag", v260)).toBe(true);
});

// ── supportedFeatureFlags ───────────────────────────────

test("returns subset for old version", () => {
  const flags = supportedFeatureFlags(v250);
  expect(flags).toContain("--sized-types");
  expect(flags).not.toContain("--cubical");
});

test("returns more flags for newer version", () => {
  const flags = supportedFeatureFlags(v270);
  expect(flags).toContain("--cubical");
  expect(flags).toContain("--sized-types");
  expect(flags).toContain("--guarded");
});

// ── hasStructuredGiveResult ─────────────────────────────

test("false before 2.9.0", () => {
  expect(hasStructuredGiveResult(v270)).toBe(false);
});

test("true at 2.9.0", () => {
  expect(hasStructuredGiveResult(v290)).toBe(true);
});

// ── filePathDescription ─────────────────────────────────

test("without version, mentions multiple extensions", () => {
  const desc = filePathDescription();
  expect(desc).toContain(".agda");
  expect(desc).toContain(".lagda");
  expect(desc).toContain(".lagda.md");
});

test("with old version, shows only supported formats", () => {
  const desc = filePathDescription(parseAgdaVersion("2.5.1"));
  expect(desc).toContain(".agda");
  expect(desc).toContain(".lagda");
  expect(desc).not.toContain(".lagda.md");
});
