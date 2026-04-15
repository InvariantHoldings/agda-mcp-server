import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../../../src/agda-process.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";
import { register as registerAgentUxTools } from "../../../src/tools/agent-ux-tools.js";

function createCapturingServer() {
  const registrations = new Map<string, { callback: (args: any) => any }>();
  return {
    registerTool(name: string, _spec: unknown, callback: (args: any) => any) {
      registrations.set(name, { callback });
    },
    get(name: string) {
      return registrations.get(name);
    },
    names() {
      return [...registrations.keys()];
    },
  };
}

function makeStubSession(root: string): AgdaSession {
  return {
    getAgdaVersion: () => null,
    load: async (filePath: string) => ({
      success: true,
      errors: [],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: true,
      classification: "ok-complete",
      profiling: null,
      lastCheckedLine: null,
    }),
    loadNoMetas: async (filePath: string) => {
      const text = readFileSync(filePath, "utf8");
      const hasHoles = text.includes("?");
      return {
        success: !text.includes("FAIL"),
        errors: text.includes("FAIL") ? [`${filePath}:1: simulated failure`] : [],
        warnings: [],
        goals: [],
        allGoalsText: "",
        invisibleGoalCount: 0,
        goalCount: hasHoles ? 1 : 0,
        hasHoles,
        isComplete: !hasHoles,
        classification: text.includes("FAIL") ? "type-error" : hasHoles ? "ok-with-holes" : "ok-complete",
        profiling: null,
      };
    },
  } as unknown as AgdaSession;
}

let sandbox: string;

function writeAgda(relPath: string, source: string): void {
  const abs = resolve(sandbox, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, source, "utf8");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-agent-ux-"));
  clearToolManifest();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("registers the agent-ux tool set", () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);

  expect(server.names()).toContain("agda_bulk_status");
  expect(server.names()).toContain("agda_triage_error");
  expect(server.names()).toContain("agda_find_clash_source");
  expect(server.names()).toContain("agda_effective_options");
});

test("agda_triage_error returns mechanical-rename for did-you-mean", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);

  const result = await server.get("agda_triage_error")!.callback({
    error: "Module Foo doesn't export proj1. Did you mean `proj₁`?",
  });
  expect(result.structuredContent.data.category).toBe("mechanical-rename");
  expect(result.structuredContent.data.suggestedRename).toBe("proj₁");
});

test("agda_suggest_import finds candidate modules for a symbol", async () => {
  writeAgda("agda/Lib/A.agda", "module Lib.A where\nhelper : Set\nhelper = Set\n");
  writeAgda("agda/Main.agda", "module Main where\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_suggest_import")!.callback({
    symbol: "helper",
    file: "agda/Main.agda",
  });

  expect(result.structuredContent.data.candidates.length).toBeGreaterThan(0);
  expect(result.structuredContent.data.candidates[0].module).toBe("Lib.A");
});

test("agda_apply_rename dry-run returns a diff and replacement count", async () => {
  writeAgda("agda/Main.agda", "module Main where\nfoo : Set\nfoo = Set\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_apply_rename")!.callback({
    file: "agda/Main.agda",
    from: "foo",
    to: "bar",
    dryRun: true,
  });

  expect(result.structuredContent.data.replacements).toBe(2);
  expect(result.structuredContent.data.diff).toContain("- foo : Set");
  expect(result.structuredContent.data.diff).toContain("+ bar : Set");
});

test("agda_infer_fixity_conflicts detects missing fixity precedence hazards", async () => {
  writeAgda("agda/Main.agda", "module Main where\n_≤ℕ_ : Nat -> Nat -> Set\nm ≤ℕ m + n = Set\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_infer_fixity_conflicts")!.callback({
    file: "agda/Main.agda",
  });

  expect(result.structuredContent.data.conflicts.length).toBeGreaterThan(0);
});

test("agda_effective_options reports pragma options with source tags", async () => {
  writeAgda("agda/Main.agda", "{-# OPTIONS --safe --without-K #-}\nmodule Main where\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_effective_options")!.callback({
    file: "agda/Main.agda",
  });

  const options = result.structuredContent.data.options;
  expect(options.some((entry: { option: string; source: string }) => entry.option === "--safe" && entry.source === "file-pragma")).toBe(true);
});

test("agda_postulate_closure reports transitive postulates", async () => {
  writeAgda("agda/Dep.agda", "module Dep where\npostulate ax : Set\n");
  writeAgda("agda/Main.agda", "module Main where\nopen import Dep\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_postulate_closure")!.callback({
    file: "agda/Main.agda",
    symbol: "main",
  });

  expect(result.structuredContent.data.postulates.length).toBeGreaterThan(0);
  expect(result.structuredContent.data.postulates[0].file).toContain("agda/Dep.agda");
});

test("agda_project_progress groups counts by subdirectory", async () => {
  writeAgda("agda/A/Clean.agda", "module A.Clean where\n");
  writeAgda("agda/A/Hole.agda", "module A.Hole where\nx = ?\n");
  writeAgda("agda/B/Post.agda", "module B.Post where\npostulate p : Set\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_progress")!.callback({
    directory: "agda",
  });

  expect(result.structuredContent.data.totals.files).toBe(3);
  expect(result.structuredContent.data.totals.withHoles).toBe(1);
  expect(result.structuredContent.data.totals.withPostulates).toBe(1);
});

test("agda_bulk_status clusters failures by root cause", async () => {
  writeAgda("agda/Dep.agda", "module Dep where\nFAIL\n");
  writeAgda("agda/Main.agda", "module Main where\nopen import Dep\n");

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_bulk_status")!.callback({
    directory: "agda",
  });

  expect(result.structuredContent.data.files.length).toBe(2);
  expect(result.structuredContent.data.clusters.length).toBeGreaterThan(0);
});
