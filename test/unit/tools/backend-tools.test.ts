import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerBackendTools } from "../../../src/tools/backend.js";
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

test("agda_compile returns ok=false for a missing file", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    getAgdaVersion: () => null,
    backend: {
      compile: async () => {
        throw new Error("unreachable");
      },
    },
  };

  registerBackendTools(server as unknown as McpServer, session as any, "/tmp/agda-mcp-server-test-root");

  const result = await server.get("agda_compile")!.callback({
    backend: "GHC",
    file: "Missing.agda",
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.classification).toBe("not-found");
  expect(result.structuredContent.data.text).toBe("");
  expect(result.content[0].text).toMatch(/File not found:/);
});

test("agda_compile returns invalid-path for sandbox escapes", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    getAgdaVersion: () => null,
    backend: {
      compile: async () => {
        throw new Error("unreachable");
      },
    },
  };

  registerBackendTools(server as unknown as McpServer, session as any, "/tmp/agda-mcp-server-test-root");

  const result = await server.get("agda_compile")!.callback({
    backend: "GHC",
    file: "../../etc/passwd",
  });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.classification).toBe("invalid-path");
  expect(result.structuredContent.data.text).toBe("");
  expect(result.content[0].text).toMatch(/escapes project root|resolves outside project root/);
});
