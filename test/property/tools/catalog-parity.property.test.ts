// MIT License — see LICENSE
//
// Property-based tests for catalog and parity tool output invariants.
// These test the reporting-schemas layer used by agda_tools_catalog and
// agda_protocol_parity to ensure structural consistency.

import { test, expect } from "vitest";
import { fc } from "@fast-check/vitest";
import { z } from "zod";

import {
  manifestEntrySchema,
  protocolParityEntrySchema,
  protocolParityDataSchema,
  toolsCatalogDataSchema,
  bugBundleSchema,
  renderBugBundleText,
} from "../../../src/tools/reporting-schemas.js";
import {
  listProtocolParityMatrix,
  getProtocolParitySummary,
} from "../../../src/protocol/parity-matrix.js";
import {
  clearToolManifest,
  registerManifestEntry,
  listToolManifest,
  listToolSchemas,
  type ToolCategory,
} from "../../../src/tools/manifest.js";
import { getServerVersion } from "../../../src/server-version.js";

// ── Generators ─────────────────────────────────────────────────────

const arbCategory: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  "session", "proof", "navigation", "process",
  "highlighting", "backend", "analysis", "reporting",
);

const arbToolName = fc.string({ minLength: 3, maxLength: 20 })
  .filter((s) => /^[a-z_]+$/u.test(s));

const arbParityStatus = fc.constantFrom("end-to-end", "verified", "mapped", "known-gap");
const arbCoverageLevel = fc.constantFrom("none", "unit", "integration", "mcp");

// ── manifestEntrySchema invariants ─────────────────────────────────

test("manifestEntrySchema accepts well-formed catalog entries", async () => {
  await fc.assert(
    fc.property(
      fc.record({
        name: arbToolName,
        description: fc.string({ minLength: 1, maxLength: 80 }),
        category: arbCategory,
        protocolCommands: fc.array(fc.string({ minLength: 3, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
        inputFields: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 8 }),
        outputFields: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 8 }),
      }),
      (entry) => {
        expect(() => manifestEntrySchema.parse(entry)).not.toThrow();
      },
    ),
  );
});

test("manifestEntrySchema rejects entries missing required fields", () => {
  expect(() => manifestEntrySchema.parse({})).toThrow();
  expect(() => manifestEntrySchema.parse({ name: "foo" })).toThrow();
  expect(() => manifestEntrySchema.parse({ name: "foo", description: "x", category: "proof" })).toThrow();
});

// ── toolsCatalogDataSchema invariants ──────────────────────────────

test("toolsCatalogDataSchema accepts minimal valid catalog data", () => {
  expect(() => toolsCatalogDataSchema.parse({
    serverVersion: "0.6.5",
    tools: [],
  })).not.toThrow();
});

test("toolsCatalogDataSchema accepts full catalog data", () => {
  const tools = listToolManifest();
  expect(() => toolsCatalogDataSchema.parse({
    serverVersion: getServerVersion(),
    agdaVersion: "2.6.4.3",
    supportedExtensions: [".agda", ".lagda.md"],
    supportedFeatureFlags: ["--cubical"],
    structuredGiveResult: false,
    tools,
  })).not.toThrow();
});

// ── protocolParityEntrySchema invariants ───────────────────────────

test("protocolParityEntrySchema accepts well-formed entries", async () => {
  await fc.assert(
    fc.property(
      fc.record({
        agdaCommand: fc.string({ minLength: 3, maxLength: 40 }),
        category: arbCategory,
        exposure: fc.constantFrom("mcp", "internal"),
        implemented: fc.boolean(),
        mcpTool: fc.option(fc.string({ minLength: 3, maxLength: 30 }), { nil: undefined }),
        parityStatus: arbParityStatus,
        coverageLevel: arbCoverageLevel,
        notes: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        issues: fc.array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 5 }),
      }),
      (entry) => {
        expect(() => protocolParityEntrySchema.parse(entry)).not.toThrow();
      },
    ),
  );
});

// ── protocolParityDataSchema round-trips with live data ────────────

test("live parity matrix passes protocolParityDataSchema validation", () => {
  const summary = getProtocolParitySummary();
  const entries = listProtocolParityMatrix();
  const knownGaps = entries.filter((e) => e.parityStatus === "known-gap");

  expect(() => protocolParityDataSchema.parse({
    serverVersion: getServerVersion(),
    ...summary,
    knownGaps,
    entries,
  })).not.toThrow();
});

// ── bugBundleSchema invariants ────────────────────────────────────

test("bugBundleSchema accepts a complete valid bundle", () => {
  expect(() => bugBundleSchema.parse({
    kind: "new-bug",
    bugFingerprint: "abcdef1234567890",
    title: "agda_load fails on valid file",
    affectedTool: "agda_load",
    classification: "process-error",
    serverVersion: "0.6.5",
    environment: {},
    reproduction: ["load Foo.agda", "observe error"],
    observed: "process-error response",
    expected: "ok-complete response",
    diagnostics: [{ severity: "error", message: "cannot read:" }],
    evidence: {},
  })).not.toThrow();
});

test("bugBundleSchema rejects invalid kind values", () => {
  expect(() => bugBundleSchema.parse({
    kind: "invalid-kind",
    bugFingerprint: "abc",
    title: "x",
    affectedTool: "agda_load",
    classification: "x",
    serverVersion: "0.6.5",
    environment: {},
    reproduction: [],
    observed: "x",
    expected: "x",
    diagnostics: [],
    evidence: {},
  })).toThrow();
});

// ── renderBugBundleText output invariants ─────────────────────────

test("renderBugBundleText always includes the affected tool and title", async () => {
  await fc.assert(
    fc.property(
      fc.record({
        affectedTool: arbToolName,
        title: fc.string({ minLength: 1, maxLength: 60 }),
      }),
      ({ affectedTool, title }) => {
        const bundle = {
          kind: "new-bug" as const,
          bugFingerprint: "abcdef1234567890",
          title,
          affectedTool,
          classification: "process-error",
          serverVersion: "0.6.5",
          environment: {},
          reproduction: [],
          observed: "x",
          expected: "y",
          diagnostics: [],
          evidence: {},
        };
        const text = renderBugBundleText("New bug report", bundle);
        expect(text).toContain(affectedTool);
        expect(text).toContain(title);
      },
    ),
  );
});

test("renderBugBundleText output is a non-empty string", async () => {
  await fc.assert(
    fc.property(
      fc.record({
        kind: fc.constantFrom("new-bug" as const, "update" as const, "regression" as const),
        observed: fc.string({ minLength: 1, maxLength: 100 }),
        expected: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      ({ kind, observed, expected }) => {
        const bundle = {
          kind,
          bugFingerprint: "abcdef1234567890",
          title: "test",
          affectedTool: "agda_load",
          classification: "x",
          serverVersion: "0.6.5",
          environment: {},
          reproduction: [],
          observed,
          expected,
          diagnostics: [],
          evidence: {},
        };
        const text = renderBugBundleText("Test", bundle);
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
      },
    ),
  );
});

// ── Manifest + schema list consistency against live registration ───

test("live tool manifest and schema lists have matching entries and names", () => {
  const manifest = listToolManifest();
  const schemas = listToolSchemas();

  expect(manifest.length).toBe(schemas.length);

  const manifestNames = new Set(manifest.map((m) => m.name));
  const schemaNames = new Set(schemas.map((s) => s.name));

  for (const name of manifestNames) {
    expect(schemaNames.has(name), `${name} in manifest but not schemas`).toBe(true);
  }
  for (const name of schemaNames) {
    expect(manifestNames.has(name), `${name} in schemas but not manifest`).toBe(true);
  }
});

test("every live manifest entry has a valid ToolCategory", () => {
  const validCategories = new Set([
    "session", "proof", "navigation", "process",
    "highlighting", "backend", "analysis", "reporting",
  ]);
  for (const entry of listToolManifest()) {
    expect(validCategories.has(entry.category), `${entry.name} has invalid category ${entry.category}`).toBe(true);
  }
});

test("every live manifest entry has a non-empty description", () => {
  for (const entry of listToolManifest()) {
    expect(entry.description.trim().length, `${entry.name} has empty description`).toBeGreaterThan(0);
  }
});
