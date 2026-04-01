import test from "node:test";
import assert from "node:assert/strict";

import { registerSessionLoadTools } from "../../../dist/session/load-tool-registration.js";
import { clearToolManifest } from "../../../dist/tools/manifest.js";

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

    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
    assert.equal(result.structuredContent.classification, "invalid-path");
    assert.equal(result.structuredContent.data.classification, "invalid-path");
    assert.equal(result.structuredContent.data.file, "../../etc/passwd");
    assert.deepEqual(result.structuredContent.diagnostics, [
      {
        severity: "error",
        message: "Invalid file path: ../../etc/passwd",
        code: "invalid-path",
      },
    ]);
  });
}
