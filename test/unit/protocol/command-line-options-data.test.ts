// MIT License — see LICENSE
//
// Pin the JSON-data invariants that `command-line-options.ts` relies
// on. The validator and "did you mean" suggestions both consume the
// extracted JSON; if a future edit accidentally drops the schema or
// reshapes a key, these tests catch it before runtime does.

import { test, expect } from "vitest";

import {
  COMMON_AGDA_FLAGS,
  validateCommandLineOptions,
} from "../../../src/protocol/command-line-options.js";

test("COMMON_AGDA_FLAGS is loaded from JSON and non-empty", () => {
  expect(Array.isArray(COMMON_AGDA_FLAGS)).toBe(true);
  expect(COMMON_AGDA_FLAGS.length).toBeGreaterThan(20);
});

test("every COMMON_AGDA_FLAGS entry starts with '-'", () => {
  for (const flag of COMMON_AGDA_FLAGS) {
    expect(flag.startsWith("-")).toBe(true);
  }
});

test("every COMMON_AGDA_FLAGS entry passes its own validator", () => {
  // If the validator and the curated list ever drift (e.g. someone
  // adds `--interaction-foo` to COMMON without realising it's blocked),
  // catch the inconsistency here.
  for (const flag of COMMON_AGDA_FLAGS) {
    const result = validateCommandLineOptions([flag]);
    expect(result.valid, `${flag} should be valid`).toBe(true);
  }
});

test("the blocked-flag list still rejects --interaction-json (regression guard)", () => {
  // The JSON migration could silently drop entries from the blocked
  // list. Pin the load-bearing case: --interaction-json must stay
  // blocked because passing it would conflict with the MCP server's
  // own session mode.
  const result = validateCommandLineOptions(["--interaction-json"]);
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toContain("conflicts with the MCP server");
});

test("the blocked-flag list still rejects -V case-sensitively (regression guard)", () => {
  expect(validateCommandLineOptions(["-V"]).valid).toBe(false);
  // Lowercase -v is verbosity, not blocked.
  expect(validateCommandLineOptions(["-v"]).valid).toBe(true);
});
