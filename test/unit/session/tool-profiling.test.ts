import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerSessionLoadTools } from "../../../src/session/load-tool-registration.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

function createCapturingServer() {
  const registrations = new Map<string, { name: string; spec: unknown; callback: (args: any) => any }>();

  return {
    registerTool(name: string, spec: unknown, callback: (args: any) => any) {
      registrations.set(name, { name, spec, callback });
    },
    get(name: string) {
      return registrations.get(name);
    },
  };
}

function createSuccessfulSessionStub() {
  return {
    getLoadedFile() {
      return null;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    load: async () => ({
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
    }),
    loadNoMetas: async () => ({
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
    }),
  };
}

function createProfilingSessionStub() {
  return {
    getLoadedFile() {
      return null;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    load: async () => ({
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
      profiling: "Total: 1.23s (type-checking) / 0.45s (scope checking)",
    }),
    loadNoMetas: async () => ({
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
      profiling: "Module timing: 0.5s",
    }),
  };
}

// ── agda_load returns invalid-profile-options for bad profile options ─

test("agda_load rejects invalid profile options with classification invalid-profile-options", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
  );

  const result = await server.get("agda_load")!.callback({
    file: "Example.agda",
    profileOptions: ["bogus"],
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-profile-options");
  expect(result.structuredContent.data.errors.length).toBeGreaterThan(0);
  expect(result.structuredContent.data.errors[0]).toContain("Not a valid profiling option");
});

test("agda_load rejects mutually exclusive profile options", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
  );

  const result = await server.get("agda_load")!.callback({
    file: "Example.agda",
    profileOptions: ["internal", "modules"],
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-profile-options");
  expect(result.structuredContent.data.errors[0]).toContain("Cannot use");
});

// ── agda_typecheck returns invalid-profile-options for bad options ────

test("agda_typecheck rejects invalid profile options with classification invalid-profile-options", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
  );

  const result = await server.get("agda_typecheck")!.callback({
    file: "Example.agda",
    profileOptions: ["xyz"],
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-profile-options");
});

// ── Schema: error paths include profiling: null ─────────────────────

for (const toolName of ["agda_load", "agda_load_no_metas", "agda_typecheck"]) {
  test(`${toolName} includes profiling: null in data for missing file`, async () => {
    clearToolManifest();
    const server = createCapturingServer();

    registerSessionLoadTools(
      server as unknown as McpServer,
      createSuccessfulSessionStub() as any,
      "/tmp/agda-mcp-server-test-root",
    );

    const result = await server.get(toolName)!.callback({
      file: "nonexistent.agda",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.data.profiling).toBeNull();
  });
}

// ── Profiling data flows through to output ───────────────────────────

test("agda_load includes profiling data in output when session returns profiling", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createProfilingSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
    {
      resolveInputFile: (_root: string, file: string) => `/tmp/agda-mcp-server-test-root/${file}`,
    },
  );

  // We need a file that exists — use a temp approach
  const { writeFileSync, mkdirSync, unlinkSync } = await import("node:fs");
  const testDir = "/tmp/agda-mcp-server-test-root";
  mkdirSync(testDir, { recursive: true });
  const testFile = `${testDir}/TestProfile.agda`;
  writeFileSync(testFile, "module TestProfile where\n");

  try {
    const result = await server.get("agda_load")!.callback({
      file: "TestProfile.agda",
      profileOptions: ["modules"],
    });

    expect(result.structuredContent.data.profiling).toBe(
      "Total: 1.23s (type-checking) / 0.45s (scope checking)",
    );
    // elapsedMs is on the envelope, not in data
    expect(typeof result.structuredContent.elapsedMs).toBe("number");
    expect(result.structuredContent.elapsedMs).toBeGreaterThanOrEqual(0);
  } finally {
    try { unlinkSync(testFile); } catch { /* cleanup: file may not exist if test failed before creation */ }
  }
});

test("agda_load_no_metas includes profiling and elapsedMs in output", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createProfilingSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
    {
      resolveInputFile: (_root: string, file: string) => `/tmp/agda-mcp-server-test-root/${file}`,
    },
  );

  const { writeFileSync, mkdirSync, unlinkSync } = await import("node:fs");
  const testDir = "/tmp/agda-mcp-server-test-root";
  mkdirSync(testDir, { recursive: true });
  const testFile = `${testDir}/TestNoMetas.agda`;
  writeFileSync(testFile, "module TestNoMetas where\n");

  try {
    const result = await server.get("agda_load_no_metas")!.callback({
      file: "TestNoMetas.agda",
    });

    expect(result.structuredContent.data.profiling).toBe("Module timing: 0.5s");
    // elapsedMs is on the envelope, not in data
    expect(typeof result.structuredContent.elapsedMs).toBe("number");
    expect(result.structuredContent.elapsedMs).toBeGreaterThanOrEqual(0);
  } finally {
    try { unlinkSync(testFile); } catch { /* cleanup: file may not exist if test failed before creation */ }
  }
});

// ── agda_load with valid profile options does not error ──────────────

test("agda_load accepts valid profile options without error", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
    {
      resolveInputFile: (_root: string, file: string) => `/tmp/agda-mcp-server-test-root/${file}`,
    },
  );

  const { writeFileSync, mkdirSync, unlinkSync } = await import("node:fs");
  const testDir = "/tmp/agda-mcp-server-test-root";
  mkdirSync(testDir, { recursive: true });
  const testFile = `${testDir}/ValidOpts.agda`;
  writeFileSync(testFile, "module ValidOpts where\n");

  try {
    const result = await server.get("agda_load")!.callback({
      file: "ValidOpts.agda",
      profileOptions: ["modules", "sharing"],
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data.profiling).toBeNull();
    // elapsedMs is on the envelope, not in data
    expect(typeof result.structuredContent.elapsedMs).toBe("number");
  } finally {
    try { unlinkSync(testFile); } catch { /* cleanup: file may not exist if test failed before creation */ }
  }
});

// ── agda_load without profileOptions works normally ──────────────────

test("agda_load works without profileOptions parameter", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
    {
      resolveInputFile: (_root: string, file: string) => `/tmp/agda-mcp-server-test-root/${file}`,
    },
  );

  const { writeFileSync, mkdirSync, unlinkSync } = await import("node:fs");
  const testDir = "/tmp/agda-mcp-server-test-root";
  mkdirSync(testDir, { recursive: true });
  const testFile = `${testDir}/NoOpts.agda`;
  writeFileSync(testFile, "module NoOpts where\n");

  try {
    const result = await server.get("agda_load")!.callback({
      file: "NoOpts.agda",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.data.profiling).toBeNull();
    // elapsedMs is on the envelope, not in data
    expect(typeof result.structuredContent.elapsedMs).toBe("number");
  } finally {
    try { unlinkSync(testFile); } catch { /* cleanup: file may not exist if test failed before creation */ }
  }
});

// ── elapsedMs for invalid-profile-options is on envelope ─────────────

test("agda_load invalid profile options response has no elapsedMs in data (it is on the envelope)", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerSessionLoadTools(
    server as unknown as McpServer,
    createSuccessfulSessionStub() as any,
    "/tmp/agda-mcp-server-test-root",
  );

  const result = await server.get("agda_load")!.callback({
    file: "Example.agda",
    profileOptions: ["bogus"],
  });

  // elapsedMs should not be in data — it's on the envelope
  expect(result.structuredContent.data.elapsedMs).toBeUndefined();
});
