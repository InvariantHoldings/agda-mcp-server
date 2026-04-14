import { test, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgdaSession } from "../../../src/agda-process.js";

import { register as registerQueryTools } from "../../../src/tools/query-tools.js";
import { clearToolManifest } from "../../../src/tools/manifest.js";

// §1.2 from the observations doc: agda_metas must tag each diagnostic
// with its owning file and mark whether that file is the currently
// loaded one. These tests drive the tool callback directly, so a
// future refactor that drops the ownership-tagging code will fail
// here rather than silently in production.

function createCapturingServer() {
  const registrations = new Map<string, { callback: (args: any) => any }>();
  return {
    registerTool(name: string, _spec: unknown, callback: (args: any) => any) {
      registrations.set(name, { callback });
    },
    get(name: string) {
      return registrations.get(name);
    },
  };
}

function stubMetasSession(opts: {
  loadedFile: string | null;
  text?: string;
  errors?: string[];
  warnings?: string[];
  goals?: Array<{ goalId: number; type: string; context: string[] }>;
}): AgdaSession {
  return {
    getLoadedFile: () => opts.loadedFile,
    getLastClassification: () => null,
    getGoalIds: () => (opts.goals ?? []).map((g) => g.goalId),
    isFileStale: () => false,
    goal: {
      metas: async () => ({
        goals: opts.goals ?? [],
        text: opts.text ?? "",
        errors: opts.errors ?? [],
        warnings: opts.warnings ?? [],
      }),
    },
    query: {
      autoAll: async () => ({ solution: "" }),
      solveAll: async () => ({ solutions: [] }),
      solveOne: async () => ({ solutions: [] }),
      constraints: async () => ({ text: "" }),
    },
  } as unknown as AgdaSession;
}

test("agda_metas groups errors by file and tags ownership against the loaded file", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = stubMetasSession({
    loadedFile: "/repo/src/Loaded.agda",
    text: "Goals text",
    errors: [
      "/repo/src/Loaded.agda:12: error: in loaded file",
      "/repo/src/Dep.agda:34: error: in dependency",
      "/repo/src/Dep.agda:40: error: second in dep",
    ],
    warnings: ["/repo/src/Loaded.agda:5: deprecated"],
  });

  registerQueryTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_metas")!.callback({});

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.loadedFile).toBe("src/Loaded.agda");
  expect(data.text).toBe("Goals text");

  expect(data.errorsByFile).toHaveLength(2);

  const loadedGroup = data.errorsByFile.find(
    (g: { file: string }) => g.file === "/repo/src/Loaded.agda",
  );
  expect(loadedGroup).toBeDefined();
  expect(loadedGroup.ownedByLoadedFile).toBe(true);
  expect(loadedGroup.messages).toHaveLength(1);

  const depGroup = data.errorsByFile.find(
    (g: { file: string }) => g.file === "/repo/src/Dep.agda",
  );
  expect(depGroup).toBeDefined();
  expect(depGroup.ownedByLoadedFile).toBe(false);
  expect(depGroup.messages).toHaveLength(2);

  // The warning from the loaded file should also be tagged correctly.
  expect(data.warningsByFile).toHaveLength(1);
  expect(data.warningsByFile[0].ownedByLoadedFile).toBe(true);

  // A dependency-errors warning diagnostic must fire when non-loaded-
  // file errors are present.
  const depDiag = result.structuredContent.diagnostics.find(
    (diag: { code: string }) => diag.code === "dependency-errors",
  );
  expect(depDiag).toBeDefined();
  expect(depDiag.severity).toBe("warning");
  expect(depDiag.message).toContain("2 error");
});

test("agda_metas omits dependency-errors diagnostic when all errors belong to the loaded file", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = stubMetasSession({
    loadedFile: "/repo/src/Loaded.agda",
    errors: ["/repo/src/Loaded.agda:12: error: in loaded file only"],
  });

  registerQueryTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_metas")!.callback({});

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.errorsByFile).toHaveLength(1);
  expect(result.structuredContent.data.errorsByFile[0].ownedByLoadedFile).toBe(true);

  const depDiag = result.structuredContent.diagnostics.find(
    (diag: { code: string }) => diag.code === "dependency-errors",
  );
  expect(depDiag).toBeUndefined();
});

test("agda_metas handles the clean-no-errors case", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = stubMetasSession({
    loadedFile: "/repo/src/Clean.agda",
    goals: [],
  });

  registerQueryTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_metas")!.callback({});

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.goalCount).toBe(0);
  expect(result.structuredContent.data.errorsByFile).toEqual([]);
  expect(result.structuredContent.data.warningsByFile).toEqual([]);
  expect(result.structuredContent.data.loadedFile).toBe("src/Clean.agda");
});

test("agda_metas tags null-file-bucket entries as not-owned-by-loaded", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = stubMetasSession({
    loadedFile: "/repo/src/Loaded.agda",
    errors: ["vague error message with no file path"],
  });

  registerQueryTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_metas")!.callback({});

  expect(result.isError).toBe(false);
  const groups = result.structuredContent.data.errorsByFile;
  expect(groups).toHaveLength(1);
  expect(groups[0].file).toBeNull();
  expect(groups[0].ownedByLoadedFile).toBe(false);
});

test("agda_metas matches relative path forms against the loaded file", async () => {
  clearToolManifest();
  const server = createCapturingServer();
  const session = stubMetasSession({
    loadedFile: "/repo/src/Nested/Dir/Loaded.agda",
    errors: [
      // Absolute form — should match.
      "/repo/src/Nested/Dir/Loaded.agda:10: error: abs",
      // Relative form prefixed with workspace-relative path — should match.
      "src/Nested/Dir/Loaded.agda:20: error: rel",
    ],
  });

  registerQueryTools(server as unknown as McpServer, session, "/repo");
  const result = await server.get("agda_metas")!.callback({});

  const groups = result.structuredContent.data.errorsByFile;
  expect(groups.every((g: { ownedByLoadedFile: boolean }) => g.ownedByLoadedFile)).toBe(true);
});
