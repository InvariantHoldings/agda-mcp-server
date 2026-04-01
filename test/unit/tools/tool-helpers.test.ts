import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgdaSession } from "../../../src/agda-process.js";

import {
  ToolInvocationError,
  missingPathToolError,
  registerGoalTextTool,
  registerTextTool,
} from "../../../src/tools/tool-helpers.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

function createCapturingServer() {
  let registered: { name: string; spec: unknown; callback: (args: any) => any } | null = null;

  return {
    registerTool(name: string, spec: unknown, callback: (args: any) => any) {
      registered = { name, spec, callback };
    },
    getRegistered() {
      return registered;
    },
  };
}

test("registerTextTool returns a structured error envelope when the callback throws", async () => {
  clearToolManifest();
  const server = createCapturingServer();

  registerTextTool({
    server: server as unknown as McpServer,
    name: "agda_test_text_failure",
    description: "test",
    category: "navigation",
    inputSchema: {},
    callback: async () => {
      throw missingPathToolError("file", "/tmp/missing.agda");
    },
  });

  const result = await server.getRegistered()!.callback({});

  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.classification).toBe("not-found");
  expect(result.structuredContent.data.text).toBe("");
  expect(result.content[0].text).toMatch(/File not found: \/tmp\/missing\.agda/);
});

test("registerGoalTextTool returns a structured error envelope with goal context", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    getLoadedFile() {
      return "/tmp/Example.agda";
    },
    getGoalIds() {
      return [7];
    },
    isFileStale() {
      return false;
    },
  };

  registerGoalTextTool({
    server: server as unknown as McpServer,
    session: session as unknown as AgdaSession,
    name: "agda_test_goal_failure",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => {
      throw new ToolInvocationError({
        message: "Goal operation failed",
        classification: "tool-error",
      });
    },
  });

  const result = await server.getRegistered()!.callback({ goalId: 7 });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.data.goalId).toBe(7);
  expect(result.structuredContent.data.text).toBe("");
  expect(result.structuredContent.summary).toBe("Goal operation failed");
});

test("registerGoalTextTool invalid goal responses include text for the default schema", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = {
    getLoadedFile() {
      return "/tmp/Example.agda";
    },
    getGoalIds() {
      return [3];
    },
    isFileStale() {
      return false;
    },
  };

  registerGoalTextTool({
    server: server as unknown as McpServer,
    session: session as unknown as AgdaSession,
    name: "agda_test_goal_invalid",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => "unreachable",
  });

  const result = await server.getRegistered()!.callback({ goalId: 4 });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.classification).toBe("invalid-goal");
  expect(result.structuredContent.data.text).toBe("");
  expect(result.structuredContent.data.goalId).toBe(4);
});
