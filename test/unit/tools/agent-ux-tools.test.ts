import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../../../src/agda-process.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";
import { register as registerAgentUxTools } from "../../../src/tools/agent-ux-tools.js";
import {
  ENV_DEFAULT_FLAGS,
  PROJECT_CONFIG_FILENAME,
  invalidateProjectConfigCache,
} from "../../../src/session/project-config.js";

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

let savedEnvDefaultFlags: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-agent-ux-"));
  clearToolManifest();
  savedEnvDefaultFlags = process.env[ENV_DEFAULT_FLAGS];
  delete process.env[ENV_DEFAULT_FLAGS];
  invalidateProjectConfigCache();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedEnvDefaultFlags !== undefined) {
    process.env[ENV_DEFAULT_FLAGS] = savedEnvDefaultFlags;
  } else {
    delete process.env[ENV_DEFAULT_FLAGS];
  }
  invalidateProjectConfigCache();
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

test("agda_suggest_import returns invalid-path for escaping input file", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_suggest_import")!.callback({
    symbol: "helper",
    file: "../../etc/passwd",
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-path");
});

test("agda_suggest_import returns not-found for missing input file", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_suggest_import")!.callback({
    symbol: "helper",
    file: "agda/Missing.agda",
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("not-found");
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

test("agda_find_clash_source returns invalid-path for escaping input file", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_find_clash_source")!.callback({
    symbol: "helper",
    file: "../../etc/passwd",
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-path");
});

test("agda_find_clash_source returns not-found for missing file", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_find_clash_source")!.callback({
    symbol: "helper",
    file: "agda/Missing.agda",
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("not-found");
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

// ── agda_effective_options: project-config / env-var attribution ─────

test("agda_effective_options attributes file flags to project-config and env flags to env-var", async () => {
  writeAgda("agda/Main.agda", "{-# OPTIONS --without-K #-}\nmodule Main where\n");
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--safe";
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_effective_options")!.callback({
    file: "agda/Main.agda",
  });

  const options: Array<{ option: string; source: string }> = result.structuredContent.data.options;
  expect(options.some((entry) => entry.option === "--Werror" && entry.source === "project-config")).toBe(true);
  expect(options.some((entry) => entry.option === "--safe" && entry.source === "env-var")).toBe(true);
});

test("agda_effective_options reports a flag in BOTH file and env once per source (no misattribution)", async () => {
  writeAgda("agda/Main.agda", "module Main where\n");
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--safe";
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_effective_options")!.callback({
    file: "agda/Main.agda",
  });

  const options: Array<{ option: string; source: string }> = result.structuredContent.data.options;
  const safeFromFile = options.filter((entry) => entry.option === "--safe" && entry.source === "project-config");
  const safeFromEnv = options.filter((entry) => entry.option === "--safe" && entry.source === "env-var");
  expect(safeFromFile.length).toBe(1);
  expect(safeFromEnv.length).toBe(1);
});

// ── agda_project_config tool ─────────────────────────────────────────

test("agda_project_config reports empty state when no config", async () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_config")!.callback({});
  expect(result.structuredContent.data.configFileExists).toBe(false);
  expect(result.structuredContent.data.envVarSet).toBe(false);
  expect(result.structuredContent.data.fileFlags).toEqual([]);
  expect(result.structuredContent.data.envFlags).toEqual([]);
  expect(result.structuredContent.data.effectiveFlags).toEqual([]);
  expect(result.structuredContent.data.warnings).toEqual([]);
});

test("agda_project_config reports file flags and env flags separately", async () => {
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--safe"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--without-K";
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_config")!.callback({});
  expect(result.structuredContent.data.configFileExists).toBe(true);
  expect(result.structuredContent.data.envVarSet).toBe(true);
  expect(result.structuredContent.data.fileFlags).toEqual(["--Werror", "--safe"]);
  expect(result.structuredContent.data.envFlags).toEqual(["--without-K"]);
  expect(result.structuredContent.data.effectiveFlags).toEqual(["--Werror", "--safe", "--without-K"]);
});

test("agda_project_config surfaces warnings for unknown keys and invalid flags", async () => {
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--interaction"], typo: 1 }),
  );
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_config")!.callback({});
  const warnings: Array<{ message: string }> = result.structuredContent.data.warnings;
  expect(warnings.some((w) => w.message.includes("Unknown key 'typo'"))).toBe(true);
  expect(warnings.some((w) => w.message.includes("conflicts with the MCP server"))).toBe(true);
  // The bad flag was filtered out; the good one survives.
  expect(result.structuredContent.data.fileFlags).toEqual(["--Werror"]);
});

test("agda_project_config dedups effective flags with last-wins precedence", async () => {
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe", "--Werror"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--Werror --without-K";
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_config")!.callback({});
  // --Werror is kept at its later (env) position; --safe and --without-K are kept verbatim.
  expect(result.structuredContent.data.effectiveFlags).toEqual(["--safe", "--Werror", "--without-K"]);
});

test("agda_project_config tool is registered", () => {
  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  expect(server.names()).toContain("agda_project_config");
});

test("agda_project_config effectiveFlags matches mergeCommandLineOptions(file, env)", async () => {
  // Pins the contract that `agda_project_config`'s `effectiveFlags`
  // is exactly what `AgdaSession.load()` would build given the same
  // file+env layers and no per-call options. Drift here would be a
  // source of confusion: an agent inspecting the config would see one
  // set of flags but the actual load would use a different set.
  const { mergeCommandLineOptions } = await import("../../../src/session/project-config.js");
  writeFileSync(
    join(sandbox, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe", "--Werror"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--Werror --without-K";
  invalidateProjectConfigCache();

  const server = createCapturingServer();
  registerAgentUxTools(server as unknown as McpServer, makeStubSession(sandbox), sandbox);
  const result = await server.get("agda_project_config")!.callback({});
  const data = result.structuredContent.data;
  // The ground truth is what mergeCommandLineOptions produces — the
  // tool must agree with the helper, byte for byte.
  const expected = mergeCommandLineOptions([...data.fileFlags, ...data.envFlags], []);
  expect(data.effectiveFlags).toEqual(expected);
});
