import { test, expect } from "vitest";
import type { TestContext } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerFileTools } from "../../../src/tools/file-tools.js";
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

function ensureRepoSymlink(ctx: TestContext) {
  const sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-file-tools-"));
  const realRepoRoot = join(sandbox, "real-repo");
  const linkedRepoRoot = join(sandbox, "repo-link");
  const kernelDir = join(realRepoRoot, "agda", "Kernel");
  const outsideDir = join(sandbox, "outside");

  mkdirSync(kernelDir, { recursive: true });
  mkdirSync(outsideDir);
  writeFileSync(
    join(kernelDir, "Example.agda"),
    "module Example where\nfoo : Set\nfoo = Set\n",
  );
  writeFileSync(
    join(outsideDir, "Leaked.agda"),
    "module Leaked where\noutsideOnly : Set\noutsideOnly = Set\n",
  );

  try {
    symlinkSync(realRepoRoot, linkedRepoRoot, "dir");
    symlinkSync(join(outsideDir, "Leaked.agda"), join(kernelDir, "Leaked.agda"), "file");
  } catch (error) {
    rmSync(sandbox, { recursive: true, force: true });
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as any).code;
      if (code === "EPERM" || code === "EACCES") {
        ctx.skip();
        return null;
      }
    }
    throw error;
  }

  return { linkedRepoRoot, sandbox };
}

test("agda_list_modules keeps display paths stable when repoRoot is a symlink", async (ctx) => {
  clearToolManifest();
  const fixture = ensureRepoSymlink(ctx);
  if (!fixture) {
    return;
  }

  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, {} as any, fixture.linkedRepoRoot);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toMatch(/agda\/Kernel\/Example\.agda/);
    expect(result.content[0].text.includes("../")).toBe(false);
    expect(result.content[0].text.includes("Leaked.agda")).toBe(false);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("agda_search_definitions skips symlinked files that resolve outside the project root", async (ctx) => {
  clearToolManifest();
  const fixture = ensureRepoSymlink(ctx);
  if (!fixture) {
    return;
  }

  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, {} as any, fixture.linkedRepoRoot);

    const safeResult = await server.get("agda_search_definitions")!.callback({
      query: "foo",
      tier: "Kernel",
    });
    expect(safeResult.isError).toBe(false);
    expect(safeResult.content[0].text).toMatch(/agda\/Kernel\/Example\.agda:2/);
    expect(safeResult.content[0].text.includes("../")).toBe(false);

    const escapedResult = await server.get("agda_search_definitions")!.callback({
      query: "outsideOnly",
      tier: "Kernel",
    });
    expect(escapedResult.isError).toBe(false);
    expect(escapedResult.content[0].text).toMatch(/No matches for "outsideOnly"/);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});
