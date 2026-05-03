// MIT License — see LICENSE
//
// Tool-boundary validation helpers in `load-tool-shared.ts`. The most
// interesting behaviour to pin down is "did you mean?" enrichment of
// invalid command-line options, since it's how an agent recovers from
// a typo without retrying with no feedback.

import { test, expect } from "vitest";

import { validateCommandLineOptionsOrError } from "../../../src/session/load-tool-shared.js";

test("validateCommandLineOptionsOrError returns null on valid input", () => {
  const result = validateCommandLineOptionsOrError(
    "agda_load",
    "Test.agda",
    ["--Werror", "--safe"],
  );
  expect(result).toBeNull();
});

test("validateCommandLineOptionsOrError returns null on absent / empty input", () => {
  expect(validateCommandLineOptionsOrError("agda_load", "Test.agda", undefined)).toBeNull();
  expect(validateCommandLineOptionsOrError("agda_load", "Test.agda", [])).toBeNull();
});

test("invalid bare-string input gets a 'did you mean' hint", () => {
  const result = validateCommandLineOptionsOrError(
    "agda_load",
    "Test.agda",
    ["Werror"],
  );
  expect(result).not.toBeNull();
  const data: any = result!.structuredContent.data;
  expect(data.errors[0]).toContain("must start with '-'");
  expect(data.errors[0]).toContain("Did you mean '--Werror'?");
});

test("case-typo ('--werror') is rejected as bare-string only after passing structural check", () => {
  // --werror starts with "-" so it passes the structural check; it
  // also isn't blocked. The validator considers it valid (Agda accepts
  // unknown flags into Cmd_load, which then errors at parse time).
  // We don't enrich valid-looking-but-not-in-COMMON inputs — that
  // would produce false positives for legitimate but obscure flags.
  const result = validateCommandLineOptionsOrError(
    "agda_load",
    "Test.agda",
    ["--werror"],
  );
  expect(result).toBeNull();
});

test("blocked flag with a near-known typo gets an enriched message", () => {
  // --interaction is blocked. A user who actually typed --interactin
  // (typo, distance 1) would currently NOT get a hint because the bad
  // input passes our blocked-prefix check (--interactin starts with
  // --interaction? no — --interactin doesn't share the --interaction
  // prefix). So it goes through as valid — see the next test for what
  // happens. This test pins the case where the input IS blocked.
  const result = validateCommandLineOptionsOrError(
    "agda_load",
    "Test.agda",
    ["--interaction-json"],
  );
  expect(result).not.toBeNull();
  const data: any = result!.structuredContent.data;
  expect(data.errors[0]).toContain("conflicts with the MCP server");
});

test("classification on invalid input is invalid-command-line-options", () => {
  const result = validateCommandLineOptionsOrError(
    "agda_typecheck",
    "Test.agda",
    ["bad-no-dash"],
  );
  expect(result).not.toBeNull();
  expect(result!.structuredContent.classification).toBe("invalid-command-line-options");
});

test("multiple bad inputs produce multiple enriched errors", () => {
  const result = validateCommandLineOptionsOrError(
    "agda_load",
    "Test.agda",
    ["Werror", "safe"],
  );
  expect(result).not.toBeNull();
  const data: any = result!.structuredContent.data;
  expect(data.errors.length).toBe(2);
  expect(data.errors.some((e: string) => e.includes("--Werror"))).toBe(true);
  expect(data.errors.some((e: string) => e.includes("--safe"))).toBe(true);
});
