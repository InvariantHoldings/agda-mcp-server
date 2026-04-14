import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgdaSession } from "../../../src/agda-process.js";

import {
  ToolInvocationError,
  clearGlobalProvenance,
  errorEnvelope,
  groupDiagnosticsByFile,
  missingPathToolError,
  okEnvelope,
  registerGlobalProvenance,
  registerGoalTextTool,
  registerTextTool,
  sessionErrorStateGate,
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

test("registerGlobalProvenance values are merged into okEnvelope and errorEnvelope", () => {
  clearGlobalProvenance();
  registerGlobalProvenance("agdaVersion", "Agda 2.9.0");
  registerGlobalProvenance("serverVersion", "0.6.4");

  try {
    const ok = okEnvelope({
      tool: "agda_test",
      summary: "test",
      data: {},
      provenance: { file: "/tmp/x.agda" },
    });
    expect(ok.provenance).toEqual({
      agdaVersion: "Agda 2.9.0",
      serverVersion: "0.6.4",
      file: "/tmp/x.agda",
    });

    const err = errorEnvelope({
      tool: "agda_test",
      summary: "boom",
      data: {},
    });
    expect(err.provenance).toEqual({
      agdaVersion: "Agda 2.9.0",
      serverVersion: "0.6.4",
    });
  } finally {
    clearGlobalProvenance();
  }
});

test("local provenance keys override global ones with the same name", () => {
  clearGlobalProvenance();
  registerGlobalProvenance("agdaVersion", "Agda 2.9.0");

  try {
    const envelope = okEnvelope({
      tool: "agda_test",
      summary: "test",
      data: {},
      provenance: { agdaVersion: "Agda 2.8.0", file: "/tmp/x.agda" },
    });
    expect(envelope.provenance).toEqual({
      agdaVersion: "Agda 2.8.0",
      file: "/tmp/x.agda",
    });
  } finally {
    clearGlobalProvenance();
  }
});

test("registerGlobalProvenance with nullish value removes the key", () => {
  clearGlobalProvenance();
  registerGlobalProvenance("agdaVersion", "Agda 2.9.0");
  registerGlobalProvenance("agdaVersion", null);

  try {
    const envelope = okEnvelope({
      tool: "agda_test",
      summary: "test",
      data: {},
    });
    expect(envelope.provenance).toBeUndefined();
  } finally {
    clearGlobalProvenance();
  }
});

test("okEnvelope returns undefined provenance when global is empty and no local provided", () => {
  clearGlobalProvenance();
  const envelope = okEnvelope({
    tool: "agda_test",
    summary: "test",
    data: {},
  });
  expect(envelope.provenance).toBeUndefined();
});

// Security: the global provenance registry must not allow prototype-
// pollution writes via special property names, and the merged result
// must not inherit from Object.prototype.
test("registerGlobalProvenance rejects __proto__ / constructor / prototype keys", () => {
  clearGlobalProvenance();

  // Snapshot Object.prototype so we can detect pollution.
  const protoKeysBefore = Object.getOwnPropertyNames(Object.prototype).sort();

  registerGlobalProvenance("__proto__", { polluted: true });
  registerGlobalProvenance("constructor", { polluted: true });
  registerGlobalProvenance("prototype", { polluted: true });

  // Valid key still works.
  registerGlobalProvenance("safeKey", "safeValue");

  const envelope = okEnvelope({
    tool: "agda_test",
    summary: "test",
    data: {},
  });

  // Unsafe keys dropped, safe key present.
  expect(envelope.provenance).toEqual({ safeKey: "safeValue" });

  // Object.prototype must not have gained any new property.
  const protoKeysAfter = Object.getOwnPropertyNames(Object.prototype).sort();
  expect(protoKeysAfter).toEqual(protoKeysBefore);

  // A fresh object must not have inherited a "polluted" property.
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();

  clearGlobalProvenance();
});

test("merged provenance object has a null prototype", () => {
  clearGlobalProvenance();
  registerGlobalProvenance("agdaVersion", "Agda 2.9.0");

  try {
    const envelope = okEnvelope({
      tool: "agda_test",
      summary: "test",
      data: {},
      provenance: { file: "/tmp/x.agda" },
    });

    // The returned provenance object must not inherit from Object.prototype
    // so a future consumer can't accidentally pick up polluted properties
    // via the prototype chain.
    expect(Object.getPrototypeOf(envelope.provenance)).toBeNull();

    // toString (from Object.prototype) should NOT be reachable on a null-
    // prototype object, so accessing it returns undefined rather than the
    // inherited method.
    expect((envelope.provenance as any).toString).toBeUndefined();
  } finally {
    clearGlobalProvenance();
  }
});

test("registerGlobalProvenance rejects empty or non-string keys", () => {
  clearGlobalProvenance();

  registerGlobalProvenance("", "dropped");
  registerGlobalProvenance(42 as unknown as string, "dropped");
  registerGlobalProvenance(null as unknown as string, "dropped");
  registerGlobalProvenance("kept", "kept");

  const envelope = okEnvelope({
    tool: "agda_test",
    summary: "test",
    data: {},
  });
  expect(envelope.provenance).toEqual({ kept: "kept" });

  clearGlobalProvenance();
});

// §1.3 from the observations doc: query-style tools must not return a
// happy-path payload when the session's last load failed. The gate
// short-circuits the tool before it talks to Agda at all.
function stubSession(lastClassification: string | null, loadedFile: string | null = null): AgdaSession {
  return {
    getLastClassification: () => lastClassification,
    getLoadedFile: () => loadedFile,
    getGoalIds: () => [],
    isFileStale: () => false,
  } as unknown as AgdaSession;
}

test("sessionErrorStateGate returns unavailable when lastClassification is type-error", () => {
  const session = stubSession("type-error", "/repo/src/File.agda");

  const result = sessionErrorStateGate(session, "agda_why_in_scope", {
    name: "_+_",
    goalId: undefined,
    explanation: "",
  });

  expect(result).not.toBeNull();
  expect(result!.isError).toBe(true);
  expect(result!.structuredContent.ok).toBe(false);
  expect(result!.structuredContent.classification).toBe("unavailable");
  expect(result!.structuredContent.summary).toContain("type-error");
  expect(result!.structuredContent.summary).toContain("/repo/src/File.agda");

  const diag = result!.structuredContent.diagnostics[0];
  expect(diag.severity).toBe("error");
  expect(diag.code).toBe("session-unavailable");
  expect(diag.nextAction).toBe("agda_load");

  // Recovery hint diagnostic
  const hint = result!.structuredContent.diagnostics[1];
  expect(hint.severity).toBe("info");
  expect(hint.code).toBe("recovery-hint");
  expect(hint.nextAction).toBe("agda_load");

  // The empty data shape is preserved so the client can destructure without undefined.
  expect(result!.structuredContent.data).toEqual({
    name: "_+_",
    goalId: undefined,
    explanation: "",
  });
});

test("sessionErrorStateGate returns null when last load was ok-complete", () => {
  const session = stubSession("ok-complete", "/repo/src/File.agda");
  const result = sessionErrorStateGate(session, "agda_infer", { expr: "", goalId: undefined, inferredType: "" });
  expect(result).toBeNull();
});

test("sessionErrorStateGate returns null when last load was ok-with-holes", () => {
  const session = stubSession("ok-with-holes", "/repo/src/File.agda");
  const result = sessionErrorStateGate(session, "agda_compute", { expr: "", goalId: undefined, normalForm: "" });
  expect(result).toBeNull();
});

test("sessionErrorStateGate returns null when no load has occurred yet", () => {
  const session = stubSession(null, null);
  const result = sessionErrorStateGate(session, "agda_search_about", { query: "", results: [], text: "" });
  expect(result).toBeNull();
});

test("sessionErrorStateGate tolerates sessions that lack the getLastClassification getter", () => {
  // Sessions that don't implement the getter (e.g. older stubs, pre-#39
  // integrations) must not crash — the gate short-circuits to null.
  const session = {
    getLoadedFile: () => null,
    getGoalIds: () => [],
    isFileStale: () => false,
  } as unknown as AgdaSession;
  const result = sessionErrorStateGate(session, "agda_show_module", { moduleName: "", goalId: undefined, contents: "" });
  expect(result).toBeNull();
});

// §1.3 wrapper coverage: registerTextTool auto-gates when given a
// session whose last classification is type-error. Callback must not
// run. Regression guard against a future refactor that drops the
// auto-gate from the wrapper.
test("registerTextTool auto-gates when session.getLastClassification() === 'type-error'", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  let callbackRan = false;
  const session = {
    getLastClassification: () => "type-error",
    getLoadedFile: () => "/repo/File.agda",
  } as unknown as AgdaSession;

  registerTextTool({
    server: server as unknown as McpServer,
    session,
    name: "agda_test_autogate_text",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => {
      callbackRan = true;
      return "should not be reached";
    },
  });

  const result = await server.getRegistered()!.callback({});
  expect(callbackRan).toBe(false);
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("unavailable");
});

test("registerTextTool auto-gate is skipped when no session is passed", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  let callbackRan = false;

  registerTextTool({
    server: server as unknown as McpServer,
    // no session — gate does not apply
    name: "agda_test_nogate_text",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => {
      callbackRan = true;
      return "ran";
    },
  });

  const result = await server.getRegistered()!.callback({});
  expect(callbackRan).toBe(true);
  expect(result.isError).toBe(false);
});

test("registerGoalTextTool auto-gates when session is in type-error state even with a valid goalId", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  let callbackRan = false;
  const session = {
    getLoadedFile: () => "/repo/File.agda",
    getGoalIds: () => [0], // stale goal id from a previous successful load
    getLastClassification: () => "type-error",
    isFileStale: () => false,
  } as unknown as AgdaSession;

  registerGoalTextTool({
    server: server as unknown as McpServer,
    session,
    name: "agda_test_autogate_goal",
    description: "test",
    category: "proof",
    inputSchema: {},
    callback: async () => {
      callbackRan = true;
      return "should not be reached";
    },
  });

  const result = await server.getRegistered()!.callback({ goalId: 0 });
  expect(callbackRan).toBe(false);
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("unavailable");
});

test("sessionErrorStateGate summary omits file hint when no file is loaded", () => {
  const session = stubSession("type-error", null);
  const result = sessionErrorStateGate(session, "agda_infer", { expr: "", goalId: undefined, inferredType: "" });
  expect(result).not.toBeNull();
  expect(result!.structuredContent.summary).not.toContain("(loaded file:");
  expect(result!.structuredContent.summary).toContain("type-error");
});

// §1.2: diagnostic-grouping helper
test("groupDiagnosticsByFile groups by leading file path and preserves insertion order", () => {
  const groups = groupDiagnosticsByFile([
    "/repo/src/A.agda:12: error: first A",
    "/repo/src/B.agda:3: error: first B",
    "/repo/src/A.agda:45: error: second A",
    "no file path here",
    "docs/M.lagda.md:7: info",
  ]);
  expect(groups).toEqual([
    {
      file: "/repo/src/A.agda",
      messages: [
        "/repo/src/A.agda:12: error: first A",
        "/repo/src/A.agda:45: error: second A",
      ],
    },
    {
      file: "/repo/src/B.agda",
      messages: ["/repo/src/B.agda:3: error: first B"],
    },
    {
      file: null,
      messages: ["no file path here"],
    },
    {
      file: "docs/M.lagda.md",
      messages: ["docs/M.lagda.md:7: info"],
    },
  ]);
});

test("groupDiagnosticsByFile tolerates non-string and empty entries", () => {
  const groups = groupDiagnosticsByFile([
    "" as string,
    null as unknown as string,
    undefined as unknown as string,
    42 as unknown as string,
    "/repo/src/Real.agda:1: real",
  ]);
  expect(groups).toEqual([
    { file: "/repo/src/Real.agda", messages: ["/repo/src/Real.agda:1: real"] },
  ]);
});

test("groupDiagnosticsByFile returns empty array for empty input", () => {
  expect(groupDiagnosticsByFile([])).toEqual([]);
});
