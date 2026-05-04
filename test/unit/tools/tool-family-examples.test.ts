// MIT License — see LICENSE
//
// Unit tests for the curated tool-family example table that
// agda_tools_catalog surfaces to assistants.

import { describe, test, expect, beforeAll } from "vitest";

import {
  getToolFamilyExamples,
  listAllToolFamilyExamples,
  listExampleToolNames,
} from "../../../src/tools/tool-family-examples.js";
import { clearToolManifest, listToolManifest } from "../../../src/tools/manifest.js";
import { registerCoreTools } from "../../../src/tools/register-core-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgdaSession } from "../../../src/agda-process.js";

beforeAll(() => {
  // Register the full core tool surface so we can assert that every
  // example references a tool the server actually exposes. The manifest
  // is process-global; clear-then-register so this file doesn't depend
  // on whatever state a previous test in the run left behind.
  clearToolManifest();
  const server = new McpServer({ name: "test", version: "0.0.0-test" });
  const session = new AgdaSession(process.cwd());
  try {
    registerCoreTools(server, session, process.cwd());
  } finally {
    session.destroy();
  }
});

describe("tool-family examples", () => {
  test("covers every family the issue calls out", () => {
    // Issue #18 acceptance criterion: examples cover session, goal,
    // query, backend, and reporting families. Mapped onto manifest
    // categories that's session, proof, navigation, backend, reporting.
    const required = ["session", "proof", "navigation", "backend", "reporting"] as const;
    const families = listAllToolFamilyExamples();
    for (const category of required) {
      expect(families[category], `missing examples for category ${category}`).toBeDefined();
      expect(families[category]!.length).toBeGreaterThan(0);
    }
  });

  test("each example has a non-empty summary and args object", () => {
    const families = listAllToolFamilyExamples();
    for (const [family, examples] of Object.entries(families)) {
      for (const example of examples) {
        expect(example.tool, `family ${family} has empty tool name`).toMatch(/^agda_/);
        expect(example.summary.trim().length, `${family}/${example.tool} has empty summary`).toBeGreaterThan(0);
        expect(typeof example.args, `${family}/${example.tool} args must be object`).toBe("object");
        expect(example.args).not.toBeNull();
      }
    }
  });

  test("getToolFamilyExamples is immutable — array mutation throws and does not leak", () => {
    const before = getToolFamilyExamples("session");
    const snapshot = structuredClone(before) as typeof before;
    expect(() => {
      (before as unknown as { push: (x: unknown) => void }).push({ tool: "leak", summary: "x", args: {} });
    }).toThrow(TypeError);
    expect(getToolFamilyExamples("session")).toEqual(snapshot);
  });

  test("getToolFamilyExamples is immutable — object mutation throws and does not leak", () => {
    // Per PR #52 review: a previous version returned shallow copies, so
    // a caller could rewrite an example's `summary` or `args` and watch
    // the change appear in the next agda_tools_catalog response. Deep
    // freezing prevents this — both reassignment and nested-object
    // mutation must throw in strict mode.
    const before = getToolFamilyExamples("session");
    const snapshot = structuredClone(before) as typeof before;
    expect(before.length).toBeGreaterThan(0);
    expect(() => {
      (before[0] as unknown as { summary: string }).summary = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (before[0].args as Record<string, unknown>).injected = true;
    }).toThrow(TypeError);
    expect(getToolFamilyExamples("session")).toEqual(snapshot);
  });

  test("listAllToolFamilyExamples is immutable across families and elements", () => {
    const families = listAllToolFamilyExamples();
    const snapshot = structuredClone(families) as Record<string, ReadonlyArray<{ tool: string; summary: string; args: Record<string, unknown> }>>;
    // Outer record frozen.
    expect(() => {
      (families as unknown as Record<string, unknown>).injected = "x";
    }).toThrow(TypeError);
    // Inner arrays frozen.
    const sessionExamples = families["session"]!;
    expect(() => {
      (sessionExamples as unknown as { pop: () => void }).pop();
    }).toThrow(TypeError);
    // Inner objects frozen all the way down.
    expect(() => {
      (sessionExamples[0] as unknown as { tool: string }).tool = "agda_tampered";
    }).toThrow(TypeError);
    expect(listAllToolFamilyExamples()).toEqual(snapshot);
  });

  test("every referenced tool name is registered in the live manifest", () => {
    const registered = new Set(listToolManifest().map((entry) => entry.name));
    const referenced = listExampleToolNames();
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(
        registered.has(name),
        `example references unregistered tool ${name}`,
      ).toBe(true);
    }
  });
});
