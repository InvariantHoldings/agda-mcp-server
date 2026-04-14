// Property-based tests for src/agda/version-support.ts
//
// Tests key invariants that cannot be exhaustively enumerated:
//   - monotonicity of extension / flag support in version
//   - totality / well-formedness of all exported helpers

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import { compareVersions, type AgdaVersion } from "../../../src/agda/agda-version.js";
import {
  isAgdaSourceFile,
  supportedSourceExtensions,
  supportedFeatureFlags,
  supportsFeatureFlag,
  hasStructuredGiveResult,
  hasConstraintsRewriteMode,
  filePathDescription,
  getAgdaCapabilities,
} from "../../../src/agda/version-support.js";

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a realistic-looking AgdaVersion (1–4 numeric parts). */
const arbVersion: fc.Arbitrary<AgdaVersion> = fc
  .tuple(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 15 }),
    fc.integer({ min: 0, max: 15 }),
    fc.integer({ min: 0, max: 5 }),
    fc.boolean(),
  )
  .map(([major, minor, patch, sub, pre]) => ({
    parts: sub === 0 ? [major, minor, patch] : [major, minor, patch, sub],
    prerelease: pre,
  }));

/** Pair of versions with a known ordering: (lower, higher). */
const arbVersionPair: fc.Arbitrary<[AgdaVersion, AgdaVersion]> = fc
  .tuple(arbVersion, arbVersion)
  .map(([a, b]) =>
    compareVersions(a, b) <= 0 ? [a, b] : [b, a],
  );

/** All extensions recognised by the module (without version gate). */
const ALL_EXTENSIONS = supportedSourceExtensions();

/** All flags recognised by the module (at a permissive version). */
const ALL_FLAGS = supportedFeatureFlags({ parts: [99, 0], prerelease: false });

// ── Totality: helpers never throw ───────────────────────────────────────────

test("isAgdaSourceFile never throws for any filename or version", () => {
  fc.assert(
    fc.property(fc.string(), fc.option(arbVersion), (name, ver) => {
      expect(() =>
        isAgdaSourceFile(name, ver ?? undefined),
      ).not.toThrow();
    }),
  );
});

test("supportedSourceExtensions never throws for any version", () => {
  fc.assert(
    fc.property(fc.option(arbVersion), (ver) => {
      expect(() => supportedSourceExtensions(ver ?? undefined)).not.toThrow();
    }),
  );
});

test("filePathDescription never throws for any version", () => {
  fc.assert(
    fc.property(fc.option(arbVersion), (ver) => {
      expect(() => filePathDescription(ver ?? undefined)).not.toThrow();
    }),
  );
});

test("getAgdaCapabilities never throws for any version or null", () => {
  fc.assert(
    fc.property(fc.option(arbVersion), (ver) => {
      expect(() => getAgdaCapabilities(ver ?? null)).not.toThrow();
    }),
  );
});

// ── Monotonicity: more version = more support ────────────────────────────────

test("supportedSourceExtensions is non-decreasing in version", () => {
  fc.assert(
    fc.property(arbVersionPair, ([lo, hi]) => {
      const loExts = supportedSourceExtensions(lo);
      const hiExts = supportedSourceExtensions(hi);
      // Every extension supported at the lower version is also supported at the higher.
      for (const ext of loExts) {
        expect(hiExts).toContain(ext);
      }
    }),
  );
});

test("supportedFeatureFlags is non-decreasing in version", () => {
  fc.assert(
    fc.property(arbVersionPair, ([lo, hi]) => {
      const loFlags = new Set(supportedFeatureFlags(lo));
      const hiFlags = new Set(supportedFeatureFlags(hi));
      for (const flag of loFlags) {
        expect(hiFlags.has(flag)).toBe(true);
      }
    }),
  );
});

test("hasStructuredGiveResult is non-decreasing in version", () => {
  fc.assert(
    fc.property(arbVersionPair, ([lo, hi]) => {
      // If the lower version has structured give, so does the higher.
      if (hasStructuredGiveResult(lo)) {
        expect(hasStructuredGiveResult(hi)).toBe(true);
      }
    }),
  );
});

test("hasConstraintsRewriteMode is non-decreasing in version", () => {
  fc.assert(
    fc.property(arbVersionPair, ([lo, hi]) => {
      if (hasConstraintsRewriteMode(lo)) {
        expect(hasConstraintsRewriteMode(hi)).toBe(true);
      }
    }),
  );
});

// ── Protocol-shape gates are prerelease-agnostic ─────────────────────────────
//
// Parser-identity questions (does THIS Agda's IOTCM parser accept
// the new shape?) must return the same answer for a prerelease and
// its GA counterpart — the prerelease is built from the same
// codebase, so the parser is the same. This was a real latent bug:
// a 2.9.0-rc1 build would get the pre-2.9 bare `Cmd_constraints`
// sent to it and eat a `cannot read:` error, because
// `versionAtLeast(rc1, 2.9.0)` is false (prerelease sorts below
// stable). The fix: protocol gates use `atLeastMajorMinor`, which
// ignores the prerelease flag entirely.

test("hasConstraintsRewriteMode is prerelease-agnostic", () => {
  fc.assert(
    fc.property(arbVersion, (ver) => {
      const stable: AgdaVersion = { parts: ver.parts, prerelease: false };
      const pre: AgdaVersion = { parts: ver.parts, prerelease: true };
      expect(hasConstraintsRewriteMode(pre)).toBe(hasConstraintsRewriteMode(stable));
    }),
  );
});

test("hasStructuredGiveResult is prerelease-agnostic", () => {
  fc.assert(
    fc.property(arbVersion, (ver) => {
      const stable: AgdaVersion = { parts: ver.parts, prerelease: false };
      const pre: AgdaVersion = { parts: ver.parts, prerelease: true };
      expect(hasStructuredGiveResult(pre)).toBe(hasStructuredGiveResult(stable));
    }),
  );
});

// ── .agda is always recognised ───────────────────────────────────────────────

test(".agda is always an Agda source file regardless of version", () => {
  fc.assert(
    fc.property(arbVersion, (ver) => {
      expect(isAgdaSourceFile("Foo.agda", ver)).toBe(true);
      expect(isAgdaSourceFile("deep/path/Bar.agda", ver)).toBe(true);
    }),
  );
});

test(".agda is always in supportedSourceExtensions regardless of version", () => {
  fc.assert(
    fc.property(arbVersion, (ver) => {
      expect(supportedSourceExtensions(ver)).toContain(".agda");
    }),
  );
});

// ── filePathDescription includes .agda always ───────────────────────────────

test("filePathDescription always mentions .agda", () => {
  fc.assert(
    fc.property(fc.option(arbVersion), (ver) => {
      expect(filePathDescription(ver ?? undefined)).toContain(".agda");
    }),
  );
});

// ── isAgdaSourceFile is consistent with supportedSourceExtensions ────────────

test("isAgdaSourceFile(f, v) iff suffix in supportedSourceExtensions(v)", () => {
  fc.assert(
    fc.property(
      arbVersion,
      fc.constantFrom(...ALL_EXTENSIONS),
      fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[A-Za-z0-9_/]+$/.test(s)),
      (ver, ext, basename) => {
        const filename = `${basename}${ext}`;
        const supported = supportedSourceExtensions(ver).includes(ext);
        expect(isAgdaSourceFile(filename, ver)).toBe(supported);
      },
    ),
  );
});

// ── Non-Agda files are always rejected ───────────────────────────────────────

test("non-Agda files are always rejected regardless of version", () => {
  const nonAgda = [".hs", ".py", ".ts", ".js", ".md", ".txt", ".json", ".v"];
  fc.assert(
    fc.property(
      arbVersion,
      fc.constantFrom(...nonAgda),
      fc.string({ minLength: 1 }).filter((s) => /^[A-Za-z0-9_]+$/.test(s)),
      (ver, ext, basename) => {
        expect(isAgdaSourceFile(`${basename}${ext}`, ver)).toBe(false);
      },
    ),
  );
});

// ── supportsFeatureFlag is consistent with supportedFeatureFlags ─────────────

test("supportsFeatureFlag consistent with supportedFeatureFlags set membership", () => {
  fc.assert(
    fc.property(
      arbVersion,
      fc.constantFrom(...ALL_FLAGS),
      (ver, flag) => {
        const fromSet = supportedFeatureFlags(ver).includes(flag);
        expect(supportsFeatureFlag(flag, ver)).toBe(fromSet);
      },
    ),
  );
});

// ── getAgdaCapabilities null ↔ all-undefined ─────────────────────────────────

test("getAgdaCapabilities(null) returns all-undefined fields", () => {
  const caps = getAgdaCapabilities(null);
  expect(caps.agdaVersion).toBeUndefined();
  expect(caps.supportedExtensions).toBeUndefined();
  expect(caps.supportedFeatureFlags).toBeUndefined();
  expect(caps.structuredGiveResult).toBeUndefined();
});

test("getAgdaCapabilities(v) always populates all fields when version is non-null", () => {
  fc.assert(
    fc.property(arbVersion, (ver) => {
      const caps = getAgdaCapabilities(ver);
      expect(caps.agdaVersion).toBeDefined();
      expect(caps.supportedExtensions).toBeDefined();
      expect(caps.supportedFeatureFlags).toBeDefined();
      expect(typeof caps.structuredGiveResult).toBe("boolean");
    }),
  );
});
