import { test, expect } from "vitest";
import {
  parseAgdaVersion,
  compareVersions,
  versionAtLeast,
  formatVersion,
} from "../../helpers/agda-version.js";

// ── parseAgdaVersion ────────────────────────────────────

test("parses bare dotted version", () => {
  expect(parseAgdaVersion("2.7.0.1")).toEqual([2, 7, 0, 1]);
});

test("parses 'Agda version X.Y.Z' output", () => {
  expect(parseAgdaVersion("Agda version 2.7.0.1")).toEqual([2, 7, 0, 1]);
});

test("parses two-component version", () => {
  expect(parseAgdaVersion("2.8")).toEqual([2, 8]);
});

test("parses version with trailing text", () => {
  expect(parseAgdaVersion("Agda version 2.9.0-rc1")).toEqual([2, 9, 0]);
});

test("throws on unparseable input", () => {
  expect(() => parseAgdaVersion("no version here")).toThrow();
});

// ── compareVersions ─────────────────────────────────────

test("equal versions return 0", () => {
  expect(compareVersions([2, 7, 0, 1], [2, 7, 0, 1])).toBe(0);
});

test("shorter tuple equals zero-padded", () => {
  expect(compareVersions([2, 7], [2, 7, 0, 0])).toBe(0);
});

test("greater major version wins", () => {
  expect(compareVersions([3, 0], [2, 9, 9])).toBeGreaterThan(0);
});

test("lesser patch version loses", () => {
  expect(compareVersions([2, 7, 0, 0], [2, 7, 0, 1])).toBeLessThan(0);
});

// ── versionAtLeast ──────────────────────────────────────

test("exact match satisfies minimum", () => {
  expect(versionAtLeast([2, 7, 0, 1], [2, 7, 0, 1])).toBe(true);
});

test("newer version satisfies minimum", () => {
  expect(versionAtLeast([2, 9, 0], [2, 7, 0, 1])).toBe(true);
});

test("older version does not satisfy minimum", () => {
  expect(versionAtLeast([2, 6, 4], [2, 7, 0, 1])).toBe(false);
});

// ── formatVersion ───────────────────────────────────────

test("formats version tuple as dotted string", () => {
  expect(formatVersion([2, 7, 0, 1])).toBe("2.7.0.1");
});
