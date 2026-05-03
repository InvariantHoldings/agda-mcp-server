import { test, expect } from "vitest";

import { suggestSimilarFlag } from "../../../src/protocol/command-line-suggestions.js";

test("suggests --Werror for missing dashes ('Werror')", () => {
  expect(suggestSimilarFlag("Werror")).toBe("--Werror");
});

test("suggests --Werror for case typo ('--werror')", () => {
  expect(suggestSimilarFlag("--werror")).toBe("--Werror");
});

test("suggests --safe for missing dashes", () => {
  expect(suggestSimilarFlag("safe")).toBe("--safe");
});

test("suggests --without-K for case typo", () => {
  expect(suggestSimilarFlag("--Without-K")).toBe("--without-K");
});

test("returns null for empty input", () => {
  expect(suggestSimilarFlag("")).toBeNull();
  expect(suggestSimilarFlag("   ")).toBeNull();
  expect(suggestSimilarFlag("--")).toBeNull();
});

test("returns null for far-away strings", () => {
  expect(suggestSimilarFlag("--this-flag-does-not-exist-anywhere")).toBeNull();
});

test("returns the input itself if it's already a known flag", () => {
  // Distance 0 — first match wins.
  expect(suggestSimilarFlag("--Werror")).toBe("--Werror");
  expect(suggestSimilarFlag("--safe")).toBe("--safe");
});

test("handles single-character substitutions", () => {
  // --without-K → --withouk-K is one substitution
  expect(suggestSimilarFlag("--withouk-K")).toBe("--without-K");
});

test("ignores leading whitespace", () => {
  expect(suggestSimilarFlag("  Werror  ")).toBe("--Werror");
});

test("does not crash on weird unicode", () => {
  expect(() => suggestSimilarFlag("--ünïcödé")).not.toThrow();
});
