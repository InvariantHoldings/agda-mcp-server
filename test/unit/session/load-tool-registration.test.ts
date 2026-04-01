import { test, expect } from "vitest";

import { PathSandboxError } from "../../../src/repo-root.js";
import { registerSessionLoadTools } from "../../../src/session/load-tool-registration.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

function createCapturingServer() {
  const registrations = new Map();

  return {
    registerTool(name, spec, callback) {
      registrations.set(name, { name, spec, callback });
    },
    get(name) {
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

    registerSessionLoadTools(server, createSessionStub(), "/tmp/agda-mcp-server-test-root");

    const result = await server.get(toolName).callback({ file: "../../etc/passwd" });

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
      server,
      createSessionStub(),
      "/tmp/agda-mcp-server-test-root",
      {
        resolveInputFile: () => {
          throw new Error("unexpected resolver failure");
        },
      },
    );

    await expect(
      () => server.get(toolName).callback({ file: "Example.agda" }),
    ).rejects.toThrow(/unexpected resolver failure/);
  });
}

for (const toolName of ["agda_load", "agda_load_no_metas", "agda_typecheck"]) {
  test(`${toolName} still maps PathSandboxError from the resolver to invalid-path`, async () => {
    clearToolManifest();
    const server = createCapturingServer();

    registerSessionLoadTools(
      server,
      createSessionStub(),
      "/tmp/agda-mcp-server-test-root",
      {
        resolveInputFile: () => {
          throw new PathSandboxError("../../etc/passwd", "Path '../../etc/passwd' escapes project root");
        },
      },
    );

    const result = await server.get(toolName).callback({ file: "../../etc/passwd" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.classification).toBe("invalid-path");
  });
}
