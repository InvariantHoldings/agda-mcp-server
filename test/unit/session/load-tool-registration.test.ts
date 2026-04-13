import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  const root = mkdtempSync(resolve(tmpdir(), "agda-mcp-ssot-"));
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
