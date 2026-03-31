import test from "node:test";
import assert from "node:assert/strict";

import {
  ToolInvocationError,
  missingPathToolError,
  registerGoalTextTool,
  registerTextTool,
} from "../../../dist/tools/tool-helpers.js";
import { clearToolManifest } from "../../../dist/tools/manifest.js";

function createCapturingServer() {
  let registered = null;

  return {
    registerTool(name, spec, callback) {
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
    server,
    name: "agda_test_text_failure",
    description: "test",
    category: "navigation",
    inputSchema: {},
    callback: async () => {
      throw missingPathToolError("file", "/tmp/missing.agda");
    },
  });

  const result = await server.getRegistered().callback({});

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.classification, "not-found");
  assert.equal(result.structuredContent.data.text, "");
  assert.match(result.content[0].text, /File not found: \/tmp\/missing\.agda/);
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
    server,
    session,
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

  const result = await server.getRegistered().callback({ goalId: 7 });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.data.goalId, 7);
  assert.equal(result.structuredContent.data.text, "");
  assert.equal(result.structuredContent.summary, "Goal operation failed");
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
    server,
    session,
    name: "agda_test_goal_invalid",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => "unreachable",
  });

  const result = await server.getRegistered().callback({ goalId: 4 });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.equal(result.structuredContent.classification, "invalid-goal");
  assert.equal(result.structuredContent.data.text, "");
  assert.equal(result.structuredContent.data.goalId, 4);
});
