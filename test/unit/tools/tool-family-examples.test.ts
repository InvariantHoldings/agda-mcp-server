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
import { listToolManifest } from "../../../src/tools/manifest.js";
import { registerCoreTools } from "../../../src/tools/register-core-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgdaSession } from "../../../src/agda-process.js";

beforeAll(() => {
  // Register the full core tool surface so we can assert that every
  // example references a tool the server actually exposes. Tests run
  // sequentially within a file, and the manifest is process-global, so
  // a single registration is sufficient.
  if (listToolManifest().length === 0) {
    const server = new McpServer({ name: "test", version: "0.0.0-test" });
    const session = new AgdaSession(process.cwd());
    registerCoreTools(server, session, process.cwd());
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

  test("getToolFamilyExamples returns a stable copy per call", () => {
    const a = getToolFamilyExamples("session");
    const b = getToolFamilyExamples("session");
    expect(a).toEqual(b);
    a.push({ tool: "leak", summary: "should not persist", args: {} });
    expect(getToolFamilyExamples("session")).toEqual(b);
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
