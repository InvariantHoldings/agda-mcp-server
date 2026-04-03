import { test, expect } from "vitest";
import {
  parseAgdaVersion,
  compareVersions,
  versionAtLeast,
  formatVersion,
} from "../../helpers/agda-version.js";

// ── parseAgdaVersion ────────────────────────────────────

test("parses bare dotted version", () => {
  expect(parseAgdaVersion("2.7.0.1")).toEqual({ parts: [2, 7, 0, 1], prerelease: false });
});

test("parses 'Agda version X.Y.Z' output", () => {
  expect(parseAgdaVersion("Agda version 2.7.0.1")).toEqual({ parts: [2, 7, 0, 1], prerelease: false });
});

test("parses two-component version", () => {
  expect(parseAgdaVersion("2.8")).toEqual({ parts: [2, 8], prerelease: false });
});

test("parses prerelease version", () => {
  expect(parseAgdaVersion("Agda version 2.9.0-rc1")).toEqual({ parts: [2, 9, 0], prerelease: true });
});

test("parses beta prerelease", () => {
  expect(parseAgdaVersion("2.8.0-beta2")).toEqual({ parts: [2, 8, 0], prerelease: true });
});

test("throws on unparseable input", () => {
  expect(() => parseAgdaVersion("no version here")).toThrow();
});

// ── compareVersions ─────────────────────────────────────

test("equal stable versions return 0", () => {
  expect(compareVersions(
    { parts: [2, 7, 0, 1], prerelease: false },
    { parts: [2, 7, 0, 1], prerelease: false },
  )).toBe(0);
});

test("shorter tuple equals zero-padded", () => {
  expect(compareVersions(
    { parts: [2, 7], prerelease: false },
    { parts: [2, 7, 0, 0], prerelease: false },
  )).toBe(0);
});

test("greater major version wins", () => {
  expect(compareVersions(
    { parts: [3, 0], prerelease: false },
    { parts: [2, 9, 9], prerelease: false },
  )).toBeGreaterThan(0);
});

test("lesser patch version loses", () => {
  expect(compareVersions(
    { parts: [2, 7, 0, 0], prerelease: false },
    { parts: [2, 7, 0, 1], prerelease: false },
  )).toBeLessThan(0);
});

test("prerelease is less than same stable version", () => {
  expect(compareVersions(
    { parts: [2, 9, 0], prerelease: true },
    { parts: [2, 9, 0], prerelease: false },
  )).toBeLessThan(0);
});

test("prerelease of higher version still beats lower stable", () => {
  expect(compareVersions(
    { parts: [2, 9, 0], prerelease: true },
    { parts: [2, 8, 999], prerelease: false },
  )).toBeGreaterThan(0);
});

test("two prereleases with same parts are equal", () => {
  expect(compareVersions(
    { parts: [2, 9, 0], prerelease: true },
    { parts: [2, 9, 0], prerelease: true },
  )).toBe(0);
});

// ── versionAtLeast ──────────────────────────────────────

test("exact match satisfies minimum", () => {
  expect(versionAtLeast(
    { parts: [2, 7, 0, 1], prerelease: false },
    { parts: [2, 7, 0, 1], prerelease: false },
  )).toBe(true);
});

test("newer version satisfies minimum", () => {
  expect(versionAtLeast(
    { parts: [2, 9, 0], prerelease: false },
    { parts: [2, 7, 0, 1], prerelease: false },
  )).toBe(true);
});

test("older version does not satisfy minimum", () => {
  expect(versionAtLeast(
    { parts: [2, 6, 4], prerelease: false },
    { parts: [2, 7, 0, 1], prerelease: false },
  )).toBe(false);
});

test("prerelease does NOT satisfy same stable minimum", () => {
  expect(versionAtLeast(
    { parts: [2, 9, 0], prerelease: true },
    { parts: [2, 9, 0], prerelease: false },
  )).toBe(false);
});

test("prerelease satisfies lower stable minimum", () => {
  expect(versionAtLeast(
    { parts: [2, 9, 0], prerelease: true },
    { parts: [2, 8, 0], prerelease: false },
  )).toBe(true);
});

// ── formatVersion ───────────────────────────────────────

test("formats stable version as dotted string", () => {
  expect(formatVersion({ parts: [2, 7, 0, 1], prerelease: false })).toBe("2.7.0.1");
});

test("formats prerelease version with -pre suffix", () => {
  expect(formatVersion({ parts: [2, 9, 0], prerelease: true })).toBe("2.9.0-pre");
});
