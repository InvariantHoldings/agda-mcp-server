// MIT License — see LICENSE
//
// Pin the path-extraction invariants that every consumer of
// `extractPathFromDiagnostic`, `AGDA_SOURCE_PATH_RE`, and the
// upstream platform-aware path helpers depends on. The regex used to
// over-narrow to `[A-Za-z0-9_./-]`, which silently dropped Windows
// path separators and unicode identifiers; consumers would just stop
// seeing the path at all.

import { test, expect } from "vitest";

import {
  AGDA_SOURCE_PATH_RE,
  AGDA_SOURCE_SUFFIX_RE,
  extractPathFromDiagnostic,
  moduleNameFromPath,
  toForwardSlashes,
  toPlatformSeparators,
} from "../../../src/agda/source-path-utils.js";

test("extracts a POSIX absolute path with .agda extension", () => {
  const msg = "Error at /repo/src/Foo.agda:12:3: missing definition";
  expect(extractPathFromDiagnostic(msg)).toBe("/repo/src/Foo.agda");
});

test("extracts a relative POSIX path", () => {
  const msg = "src/Bar.agda:1:1: parse error";
  expect(extractPathFromDiagnostic(msg)).toBe("src/Bar.agda");
});

test("extracts a literate file path", () => {
  const msg = "Error at /repo/Foo.lagda.md:5: ...";
  expect(extractPathFromDiagnostic(msg)).toBe("/repo/Foo.lagda.md");
});

test("returns null for a diagnostic without a path", () => {
  expect(extractPathFromDiagnostic("Internal error: panic")).toBeNull();
});

// ── Windows-path support (regression for the regex over-narrowing) ──

test("extracts a Windows backslash path with drive letter", () => {
  const msg = "C:\\repo\\src\\Foo.agda:12:3: missing definition";
  expect(extractPathFromDiagnostic(msg)).toBe("C:\\repo\\src\\Foo.agda");
});

test("extracts a Windows mixed-separator path", () => {
  // VS Code Windows builds frequently surface paths with mixed
  // separators in error text; the regex should still capture them.
  const msg = "C:/repo/src\\Foo.agda:1:1: error";
  expect(extractPathFromDiagnostic(msg)).toBe("C:/repo/src\\Foo.agda");
});

test("extracts a UNC path on Windows", () => {
  const msg = "Error at \\\\server\\share\\repo\\Foo.agda:1:1";
  expect(extractPathFromDiagnostic(msg)).toBe("\\\\server\\share\\repo\\Foo.agda");
});

test("extracts paths with unicode identifiers", () => {
  // Agda module names can contain unicode characters (lots of dependent-
  // type proof libraries use Greek / mathematical symbols). The old
  // [A-Za-z0-9_./-] regex would chop these off mid-name.
  const msg = "/repo/Категория/Δ.agda:1:1: parse error";
  expect(extractPathFromDiagnostic(msg)).toBe("/repo/Категория/Δ.agda");
});

// ── Boundary cases ──────────────────────────────────────────────────

test("does not capture trailing punctuation as part of the path", () => {
  // The diagnostic format "Foo.agda:12:3" should not capture the colon.
  const msg = "Error at /repo/Foo.agda:12:3";
  expect(extractPathFromDiagnostic(msg)).toBe("/repo/Foo.agda");
});

test("AGDA_SOURCE_PATH_RE has no global flag (callers rely on .exec semantics)", () => {
  // If someone added `g`, repeated `.exec()` calls would maintain
  // lastIndex and skip alternates, which `extractPathFromDiagnostic`
  // assumes is reset between calls.
  expect(AGDA_SOURCE_PATH_RE.global).toBe(false);
});

// ── AGDA_SOURCE_SUFFIX_RE ──────────────────────────────────────────

test("AGDA_SOURCE_SUFFIX_RE matches every literate variant at the END only", () => {
  // The end anchor is what makes `Foo.lagda.md` strip cleanly down
  // to `Foo`. A non-anchored regex would also match `agda` mid-string.
  expect("Foo.agda".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.md".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.tex".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.rst".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.org".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.tree".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
  expect("Foo.lagda.typ".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo");
});

test("AGDA_SOURCE_SUFFIX_RE leaves non-Agda extensions untouched", () => {
  expect("Foo.txt".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("Foo.txt");
  expect("README.md".replace(AGDA_SOURCE_SUFFIX_RE, "")).toBe("README.md");
});

// ── moduleNameFromPath ─────────────────────────────────────────────

test("moduleNameFromPath maps a POSIX agda/ path to a dotted module name", () => {
  expect(moduleNameFromPath("agda/Foo/Bar.agda")).toBe("Foo.Bar");
});

test("moduleNameFromPath strips literate suffixes too", () => {
  expect(moduleNameFromPath("agda/Foo/Bar.lagda.md")).toBe("Foo.Bar");
});

test("moduleNameFromPath handles Windows backslashes", () => {
  expect(moduleNameFromPath("agda\\Foo\\Bar.agda")).toBe("Foo.Bar");
});

test("moduleNameFromPath leaves a non-agda root prefix in place", () => {
  // Only the literal `agda.` prefix is dropped; paths under other
  // top-level directories keep theirs.
  expect(moduleNameFromPath("research/Foo.agda")).toBe("research.Foo");
});

// ── Separator normalization ────────────────────────────────────────

test("toForwardSlashes converts every backslash to forward slash", () => {
  expect(toForwardSlashes("C:\\path\\to\\Foo.agda")).toBe("C:/path/to/Foo.agda");
  expect(toForwardSlashes("/already/posix")).toBe("/already/posix");
  expect(toForwardSlashes("mixed\\path/with\\both")).toBe("mixed/path/with/both");
});

test("toPlatformSeparators on POSIX converts to forward slashes", () => {
  // We're running tests on macOS (POSIX) so the platform separator is /.
  // The result should use only forward slashes regardless of input.
  expect(toPlatformSeparators("C:\\path\\to\\Foo")).toBe("C:/path/to/Foo");
  expect(toPlatformSeparators("/already/posix")).toBe("/already/posix");
});
