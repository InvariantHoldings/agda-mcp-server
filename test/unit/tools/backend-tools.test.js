import test from "node:test";
import assert from "node:assert/strict";

import { register as registerBackendTools } from "../../../dist/tools/backend.js";
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

test("agda_compile returns ok=false for a missing file", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    backend: {
      compile: async () => {
        throw new Error("unreachable");
      },
    },
  };

  registerBackendTools(server, session, "/tmp/agda-mcp-server-test-root");

  const result = await server.get("agda_compile").callback({
    backend: "GHC",
    file: "Missing.agda",
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.classification, "not-found");
  assert.equal(result.structuredContent.data.text, "");
  assert.match(result.content[0].text, /File not found:/);
});

test("agda_compile returns invalid-path for sandbox escapes", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    backend: {
      compile: async () => {
        throw new Error("unreachable");
      },
    },
  };

  registerBackendTools(server, session, "/tmp/agda-mcp-server-test-root");

  const result = await server.get("agda_compile").callback({
    backend: "GHC",
    file: "../../etc/passwd",
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.classification, "invalid-path");
  assert.equal(result.structuredContent.data.text, "");
  assert.match(result.content[0].text, /escapes project root|resolves outside project root/);
});
