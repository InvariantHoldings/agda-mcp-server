import { test, expect } from "vitest";

import {
  validateCommandLineOptions,
  COMMON_AGDA_FLAGS,
} from "../../../src/protocol/command-line-options.js";

// ── Valid flags ──────────────────────────────────────────────────────

test("single valid flag is accepted", () => {
  const result = validateCommandLineOptions(["--Werror"]);
  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.options).toEqual(["--Werror"]);
});

test("multiple valid flags are accepted", () => {
  const result = validateCommandLineOptions(["--safe", "--Werror", "--without-K"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["--safe", "--Werror", "--without-K"]);
});

test("short flags are accepted", () => {
  const result = validateCommandLineOptions(["-W"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["-W"]);
});

test("flags with values are accepted", () => {
  const result = validateCommandLineOptions(["--warning=error"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["--warning=error"]);
});

test("empty input returns valid with no options", () => {
  const result = validateCommandLineOptions([]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual([]);
});

test("empty strings are silently skipped", () => {
  const result = validateCommandLineOptions(["", "--safe", "  "]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["--safe"]);
});

test("duplicates are deduplicated", () => {
  const result = validateCommandLineOptions(["--safe", "--Werror", "--safe"]);
  expect(result.valid).toBe(true);
  expect(result.options).toEqual(["--safe", "--Werror"]);
});

// ── Invalid flags ────────────────────────────────────────────────────

test("non-flag strings are rejected", () => {
  const result = validateCommandLineOptions(["safe"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("must start with '-'");
});

test("blocked --interaction-json flag is rejected", () => {
  const result = validateCommandLineOptions(["--interaction-json"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("conflicts with the MCP server");
});

test("blocked --interaction flag is rejected", () => {
  const result = validateCommandLineOptions(["--interaction"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("conflicts with the MCP server");
});

test("blocked --version flag is rejected", () => {
  const result = validateCommandLineOptions(["--version"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("conflicts with the MCP server");
});

// ── COMMON_AGDA_FLAGS ────────────────────────────────────────────────

test("COMMON_AGDA_FLAGS contains well-known flags", () => {
  expect(COMMON_AGDA_FLAGS).toContain("--safe");
  expect(COMMON_AGDA_FLAGS).toContain("--Werror");
  expect(COMMON_AGDA_FLAGS).toContain("--without-K");
  expect(COMMON_AGDA_FLAGS).toContain("--cubical");
});

test("all COMMON_AGDA_FLAGS pass validation individually", () => {
  for (const flag of COMMON_AGDA_FLAGS) {
    const result = validateCommandLineOptions([flag]);
    expect(result.valid).toBe(true);
  }
});
