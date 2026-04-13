import { test, expect } from "vitest";

import {
  validateProfileOptions,
  toProfileArgs,
  PROFILE_OPTIONS,
  VALID_PROFILE_OPTION_STRINGS,
  PROFILE_ALL,
  type ProfileOption,
} from "../../../src/protocol/profile-options.js";

// ── Valid single options ──────────────────────────────────────────────

test("each individual profile option is valid", () => {
  for (const opt of PROFILE_OPTIONS) {
    const result = validateProfileOptions([opt]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.options).toContain(opt);
  }
});

test("'all' is accepted and expands to all non-conflicting options", () => {
  const result = validateProfileOptions(["all"]);
  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  // "all" defaults to including "internal" (first in enum) but not "modules" or "definitions"
  expect(result.options).toContain("internal");
  expect(result.options).not.toContain("modules");
  expect(result.options).not.toContain("definitions");
  // Non-exclusive options are all included
  expect(result.options).toContain("sharing");
  expect(result.options).toContain("serialize");
  expect(result.options).toContain("constraints");
  expect(result.options).toContain("metas");
  expect(result.options).toContain("interactive");
  expect(result.options).toContain("conversion");
  expect(result.options).toContain("instances");
  expect(result.options).toContain("sections");
});

// ── Mutual exclusivity ───────────────────────────────────────────────

test("internal and modules are mutually exclusive", () => {
  const result = validateProfileOptions(["internal", "modules"]);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors[0]).toContain("modules");
  expect(result.errors[0]).toContain("internal");
});

test("internal and definitions are mutually exclusive", () => {
  const result = validateProfileOptions(["internal", "definitions"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("definitions");
});

test("modules and definitions are mutually exclusive", () => {
  const result = validateProfileOptions(["modules", "definitions"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("definitions");
});

// ── "all" respects existing exclusions ───────────────────────────────

test("'modules' then 'all' keeps modules, excludes internal and definitions", () => {
  const result = validateProfileOptions(["modules", "all"]);
  expect(result.valid).toBe(true);
  expect(result.options).toContain("modules");
  expect(result.options).not.toContain("internal");
  expect(result.options).not.toContain("definitions");
  expect(result.options).toContain("sharing");
});

test("'definitions' then 'all' keeps definitions, excludes internal and modules", () => {
  const result = validateProfileOptions(["definitions", "all"]);
  expect(result.valid).toBe(true);
  expect(result.options).toContain("definitions");
  expect(result.options).not.toContain("internal");
  expect(result.options).not.toContain("modules");
});

// ── Compatible options combine freely ────────────────────────────────

test("non-exclusive options combine freely", () => {
  const result = validateProfileOptions(["sharing", "metas", "constraints", "conversion"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["sharing", "metas", "constraints", "conversion"]);
});

test("exclusive option combined with non-exclusive options is valid", () => {
  const result = validateProfileOptions(["modules", "sharing", "metas"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["modules", "sharing", "metas"]);
});

// ── Invalid options ──────────────────────────────────────────────────

test("unknown option string is rejected", () => {
  const result = validateProfileOptions(["bogus"]);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBe(1);
  expect(result.errors[0]).toContain("Not a valid profiling option");
  expect(result.errors[0]).toContain("bogus");
});

test("multiple invalid options accumulate errors", () => {
  const result = validateProfileOptions(["foo", "bar"]);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBe(2);
});

test("mixed valid and invalid options", () => {
  const result = validateProfileOptions(["modules", "invalid"]);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBe(1);
  expect(result.options).toContain("modules");
});

// ── Case insensitivity ───────────────────────────────────────────────

test("options are case-insensitive", () => {
  const result = validateProfileOptions(["MODULES", "Sharing"]);
  expect(result.valid).toBe(true);
  expect(result.options).toContain("modules");
  expect(result.options).toContain("sharing");
});

test("ALL is accepted case-insensitively", () => {
  const result = validateProfileOptions(["ALL"]);
  expect(result.valid).toBe(true);
  expect(result.options.length).toBeGreaterThan(5);
});

// ── Deduplication ────────────────────────────────────────────────────

test("duplicate options are deduplicated", () => {
  const result = validateProfileOptions(["modules", "modules", "sharing", "sharing"]);
  expect(result.valid).toBe(true);
  const moduleCount = result.options.filter((o) => o === "modules").length;
  expect(moduleCount).toBe(1);
  const sharingCount = result.options.filter((o) => o === "sharing").length;
  expect(sharingCount).toBe(1);
});

// ── Empty input ──────────────────────────────────────────────────────

test("empty input is valid with no options", () => {
  const result = validateProfileOptions([]);
  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.options).toEqual([]);
});

// ── toProfileArgs ────────────────────────────────────────────────────

test("toProfileArgs produces --profile= flags", () => {
  const args = toProfileArgs(["modules", "sharing"]);
  expect(args).toEqual(["--profile=modules", "--profile=sharing"]);
});

test("toProfileArgs on empty list returns empty", () => {
  expect(toProfileArgs([])).toEqual([]);
});

// ── Constants ────────────────────────────────────────────────────────

test("VALID_PROFILE_OPTION_STRINGS includes 'all' and all individual options", () => {
  expect(VALID_PROFILE_OPTION_STRINGS).toContain("all");
  for (const opt of PROFILE_OPTIONS) {
    expect(VALID_PROFILE_OPTION_STRINGS).toContain(opt);
  }
});

test("PROFILE_ALL constant is 'all'", () => {
  expect(PROFILE_ALL).toBe("all");
});

test("PROFILE_OPTIONS has exactly 11 options matching Agda's ProfileOption data type", () => {
  expect(PROFILE_OPTIONS.length).toBe(11);
  const expected = [
    "internal", "modules", "definitions", "sharing", "serialize",
    "constraints", "metas", "interactive", "conversion", "instances", "sections",
  ];
  expect([...PROFILE_OPTIONS]).toEqual(expected);
});
