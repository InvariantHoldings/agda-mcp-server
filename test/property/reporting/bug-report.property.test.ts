// MIT License — see LICENSE
//
// Property-based tests for bug report bundle invariants.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";

import {
  buildBugReportBundle,
  fingerprintBugReport,
  defaultBugTitle,
  type BugReportBundleInput,
} from "../../../src/reporting/bug-report.js";

// ── Generators ──────────────────────────────────────────────────────

const arbKind = fc.constantFrom("new-bug" as const, "update" as const, "regression" as const);

const arbDiagnostic = fc.record({
  severity: fc.constantFrom("error" as const, "warning" as const, "info" as const),
  message: fc.string({ minLength: 1, maxLength: 50 }),
  code: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
});

const arbBundleInput: fc.Arbitrary<BugReportBundleInput> = fc.record({
  kind: arbKind,
  affectedTool: fc.string({ minLength: 1, maxLength: 30 }),
  classification: fc.string({ minLength: 1, maxLength: 20 }),
  observed: fc.string({ minLength: 1, maxLength: 100 }),
  expected: fc.string({ minLength: 1, maxLength: 100 }),
  reproduction: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
  diagnostics: fc.option(fc.array(arbDiagnostic, { minLength: 0, maxLength: 3 }), { nil: undefined }),
  serverVersion: fc.string({ minLength: 3, maxLength: 15 }),
  agdaVersion: fc.option(fc.string({ minLength: 3, maxLength: 10 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  existingIssue: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
});

// ── Properties ──────────────────────────────────────────────────────

test("fingerprint is always a 16-char hex string", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const fp = fingerprintBugReport(input);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    }),
  );
});

test("fingerprint is deterministic (same input → same output)", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const fp1 = fingerprintBugReport(input);
      const fp2 = fingerprintBugReport(input);
      expect(fp1).toBe(fp2);
    }),
  );
});

test("fingerprint ignores title changes", async () => {
  await fc.assert(
    fc.property(arbBundleInput, fc.string({ minLength: 1, maxLength: 30 }), (input, newTitle) => {
      const fp1 = fingerprintBugReport(input);
      const fp2 = fingerprintBugReport({ ...input, title: newTitle });
      expect(fp1).toBe(fp2);
    }),
  );
});

test("buildBugReportBundle preserves input fields", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const bundle = buildBugReportBundle(input);
      expect(bundle.kind).toBe(input.kind);
      expect(bundle.affectedTool).toBe(input.affectedTool);
      expect(bundle.classification).toBe(input.classification);
      expect(bundle.observed).toBe(input.observed);
      expect(bundle.expected).toBe(input.expected);
      expect(bundle.reproduction).toEqual(input.reproduction);
      expect(bundle.serverVersion).toBe(input.serverVersion);
    }),
  );
});

test("buildBugReportBundle always has a bugFingerprint", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const bundle = buildBugReportBundle(input);
      expect(bundle.bugFingerprint).toMatch(/^[0-9a-f]{16}$/);
    }),
  );
});

test("buildBugReportBundle always has a title", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const bundle = buildBugReportBundle(input);
      expect(bundle.title.length).toBeGreaterThan(0);
    }),
  );
});

test("defaultBugTitle includes kind for regression", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      (tool, classification) => {
        const title = defaultBugTitle({
          kind: "regression",
          affectedTool: tool,
          classification,
        });
        expect(title).toContain("regression");
      },
    ),
  );
});

test("defaultBugTitle includes issue number for updates", async () => {
  await fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.nat({ max: 10000 }),
      (tool, classification, issue) => {
        const title = defaultBugTitle({
          kind: "update",
          affectedTool: tool,
          classification,
          existingIssue: issue,
        });
        expect(title).toContain(String(issue));
      },
    ),
  );
});

test("diagnostics default to empty array", async () => {
  await fc.assert(
    fc.property(arbBundleInput, (input) => {
      const bundle = buildBugReportBundle({ ...input, diagnostics: undefined });
      expect(Array.isArray(bundle.diagnostics)).toBe(true);
    }),
  );
});
