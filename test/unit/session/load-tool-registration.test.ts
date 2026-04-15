import { test, expect } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PathSandboxError } from "../../../src/repo-root.js";
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

function createSessionStub() {
  return {
    getAgdaVersion() {
      return null;
    },
    getLoadedFile() {
      return null;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    load: async () => {
      throw new Error("unreachable");
    },
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };
}

for (const toolName of ["agda_load", "agda_load_no_metas", "agda_typecheck"]) {
  test(`${toolName} rejects escaping paths with invalid-path classification`, async () => {
    clearToolManifest();
    const server = createCapturingServer();

    registerSessionLoadTools(server as unknown as McpServer, createSessionStub() as any, "/tmp/agda-mcp-server-test-root");

    const result = await server.get(toolName)!.callback({ file: "../../etc/passwd" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
    expect(result.structuredContent.classification).toBe("invalid-path");
    expect(result.structuredContent.data.classification).toBe("invalid-path");
    expect(result.structuredContent.data.file).toBe("../../etc/passwd");
    expect(result.structuredContent.diagnostics).toEqual([
      {
        severity: "error",
        message: "Invalid file path: ../../etc/passwd",
        code: "invalid-path",
      },
    ]);
  });
}

for (const toolName of ["agda_load", "agda_load_no_metas", "agda_typecheck"]) {
  test(`${toolName} rethrows unexpected path resolver failures`, async () => {
    clearToolManifest();
    const server = createCapturingServer();

    registerSessionLoadTools(
      server as unknown as McpServer,
      createSessionStub() as any,
      "/tmp/agda-mcp-server-test-root",
      {
        resolveInputFile: () => {
          throw new Error("unexpected resolver failure");
        },
      },
    );

    await expect(
      () => server.get(toolName)!.callback({ file: "Example.agda" }),
    ).rejects.toThrow(/unexpected resolver failure/);
  });
}

for (const toolName of ["agda_load", "agda_load_no_metas", "agda_typecheck"]) {
  test(`${toolName} still maps PathSandboxError from the resolver to invalid-path`, async () => {
    clearToolManifest();
    const server = createCapturingServer();

    registerSessionLoadTools(
      server as unknown as McpServer,
      createSessionStub() as any,
      "/tmp/agda-mcp-server-test-root",
      {
        resolveInputFile: () => {
          throw new PathSandboxError("../../etc/passwd", "Path '../../etc/passwd' escapes project root");
        },
      },
    );

    const result = await server.get(toolName)!.callback({ file: "../../etc/passwd" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.classification).toBe("invalid-path");
  });
}

// Regression for issue #39: agda_typecheck and agda_load must route through
// the SAME AgdaSession instance passed to registerSessionLoadTools. Any
// implementation that spins up a parallel session for agda_typecheck
// desynchronizes currentFile/lastLoadedMtime/_build state between the two
// tools. This test is Agda-free and is the fast guard rail for the SSOT
// invariant — the full interaction is covered by the e2e test in
// test/integration/mcp/mcp-remaining-tools-e2e.test.ts.
test("agda_typecheck and agda_load share the injected AgdaSession instance", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-ssot-")));
  const fileName = "Probe.agda";
  writeFileSync(resolve(root, fileName), "module Probe where\n", "utf8");

  const loadCalls: Array<{ sessionRef: object; filePath: string }> = [];
  const loadResult = {
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
  };

  const session = {
    getAgdaVersion: () => null,
    getLoadedFile() {
      return null;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    load(this: object, filePath: string) {
      loadCalls.push({ sessionRef: this, filePath });
      return Promise.resolve(loadResult);
    },
    loadNoMetas: async () => loadResult,
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);

    const typecheck = await server.get("agda_typecheck")!.callback({ file: fileName });
    expect(typecheck.isError).toBe(false);

    const load = await server.get("agda_load")!.callback({ file: fileName });
    expect(load.isError).toBe(false);

    expect(loadCalls).toHaveLength(2);
    expect(loadCalls[0].sessionRef).toBe(session);
    expect(loadCalls[1].sessionRef).toBe(session);
    expect(loadCalls[0].filePath).toBe(loadCalls[1].filePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Agent-facing diagnostic: when a reload regresses from a previously
// successful classification into a failure, surface that transition in
// the response data and as an info diagnostic so callers know the file
// (or a dependency) likely changed out from under them.
test("agda_load surfaces regression diagnostic when reload drops from ok-complete to failure", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-regression-")));
  const fileName = "Probe.agda";
  const absPath = resolve(root, fileName);
  writeFileSync(absPath, "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
    getLoadedFile() {
      return absPath;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    getLastClassification() {
      return "ok-complete";
    },
    getLastLoadedAt() {
      return Date.now() - 3000;
    },
    load: async () => ({
      success: false,
      errors: ["Type mismatch in Probe.agda:3"],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error",
    }),
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.data.reloaded).toBe(true);
    expect(result.structuredContent.data.previousClassification).toBe("ok-complete");
    expect(typeof result.structuredContent.data.previousLoadedAtMs).toBe("number");

    const regressionDiag = result.structuredContent.diagnostics.find(
      (diag: { code: string }) => diag.code === "session-regression",
    );
    expect(regressionDiag).toBeDefined();
    expect(regressionDiag.severity).toBe("info");
    expect(regressionDiag.message).toContain("ok-complete");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agda_load surfaces structured suggestedRename in diagnostics when Agda provides did-you-mean text", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-rename-diag-")));
  const fileName = "Probe.agda";
  const absPath = resolve(root, fileName);
  writeFileSync(absPath, "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
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
      success: false,
      errors: ["Module Foo doesn't export proj1. Did you mean `proj₁`?"],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error",
      profiling: null,
      lastCheckedLine: null,
    }),
    loadNoMetas: async () => ({
      success: false,
      errors: [],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error",
      profiling: null,
      lastCheckedLine: null,
    }),
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });
    const renameDiag = result.structuredContent.diagnostics.find(
      (diag: { suggestedRename?: string }) => diag.suggestedRename === "proj₁",
    );
    expect(renameDiag).toBeDefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// §1.4: a nominally-clean load that carries a diagnostic location
// should emit the scope-check-extent info diagnostic so the caller
// knows hasHoles/goalCount may be under-reported.
test("agda_load surfaces scope-check-extent diagnostic on apparent-clean-but-suspect load", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-scope-extent-")));
  const fileName = "Probe.agda";
  writeFileSync(resolve(root, fileName), "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
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
      lastCheckedLine: 47,
    }),
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.data.lastCheckedLine).toBe(47);

    const extentDiag = result.structuredContent.diagnostics.find(
      (diag: { code: string }) => diag.code === "scope-check-extent",
    );
    expect(extentDiag).toBeDefined();
    expect(extentDiag.severity).toBe("info");
    expect(extentDiag.message).toContain("line 47");
    // In the success-shaped-but-suspect case, the diagnostic must
    // explicitly tell the caller to treat hasHoles as a lower bound.
    expect(extentDiag.message).toContain("lower bounds");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// §1.4: on a genuinely failed load (success=false), the diagnostic
// still appears but with a softer message — the agent already knows
// something's wrong, the line number is context not an alarm.
test("agda_load surfaces scope-check-extent diagnostic with context-level message on failed load", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-scope-fail-")));
  const fileName = "Probe.agda";
  writeFileSync(resolve(root, fileName), "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
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
      success: false,
      errors: ["/tmp/Probe.agda:12: error: type mismatch"],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error",
      lastCheckedLine: 12,
    }),
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });

    const extentDiag = result.structuredContent.diagnostics.find(
      (diag: { code: string }) => diag.code === "scope-check-extent",
    );
    expect(extentDiag).toBeDefined();
    expect(extentDiag.message).toContain("line 12");
    // Different phrasing for the genuinely-failed case.
    expect(extentDiag.message).not.toContain("lower bounds");
    expect(extentDiag.message).toContain("may not have been fully scope-checked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// §1.4 no-op: when lastCheckedLine is null, the scope-check-extent
// diagnostic must NOT appear at all.
test("agda_load omits scope-check-extent diagnostic when lastCheckedLine is null", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-scope-none-")));
  const fileName = "Probe.agda";
  writeFileSync(resolve(root, fileName), "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
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
      lastCheckedLine: null,
    }),
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });

    const extentDiag = result.structuredContent.diagnostics.find(
      (diag: { code: string }) => diag.code === "scope-check-extent",
    );
    expect(extentDiag).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Corollary: a first-time load (not a reload) must NOT surface the
// regression diagnostic, and previousClassification/previousLoadedAtMs
// must be null.
test("agda_load omits regression diagnostic on first load", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "agda-mcp-first-load-")));
  const fileName = "Probe.agda";
  writeFileSync(resolve(root, fileName), "module Probe where\n", "utf8");

  const session = {
    getAgdaVersion: () => null,
    getLoadedFile() {
      return null;
    },
    getGoalIds() {
      return [];
    },
    isFileStale() {
      return false;
    },
    getLastClassification() {
      return null;
    },
    getLastLoadedAt() {
      return null;
    },
    load: async () => ({
      success: false,
      errors: ["Some error"],
      warnings: [],
      goals: [],
      allGoalsText: "",
      invisibleGoalCount: 0,
      goalCount: 0,
      hasHoles: false,
      isComplete: false,
      classification: "type-error",
    }),
    loadNoMetas: async () => {
      throw new Error("unreachable");
    },
  };

  try {
    registerSessionLoadTools(server as unknown as McpServer, session as any, root);
    const result = await server.get("agda_load")!.callback({ file: fileName });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.data.reloaded).toBe(false);
    expect(result.structuredContent.data.previousClassification ?? null).toBe(null);
    expect(result.structuredContent.data.previousLoadedAtMs ?? null).toBe(null);

    const regressionDiag = result.structuredContent.diagnostics.find(
      (diag: { code: string }) => diag.code === "session-regression",
    );
    expect(regressionDiag).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
