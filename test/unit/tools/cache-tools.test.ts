import type { TestContext } from "vitest";
import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerCacheTools } from "../../../src/tools/cache-tools.js";
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

const stubSession = { getAgdaVersion: () => null } as any;

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-cache-tools-"));
  clearToolManifest();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("agda_cache_info reports zero artifacts for a never-built source", async () => {
  const dir = resolve(sandbox, "proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "proj.agda-lib"), "name: proj\ninclude: .\n");
  writeFileSync(resolve(dir, "Cold.agda"), "module Cold where\n");

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, dir);

  const result = await server.get("agda_cache_info")!.callback({ file: "Cold.agda" });

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.artifactCount).toBe(0);
  expect(result.structuredContent.data.staleCount).toBe(0);
  expect(result.structuredContent.data.hasStaleArtifacts).toBe(false);
  expect(result.content[0].text).toContain("No `.agdai` artifacts on disk");
});

test("agda_cache_info reports a separated artifact and identifies it as fresh", async () => {
  const dir = resolve(sandbox, "proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(dir, "Mod.agda");
  writeFileSync(sourcePath, "module Mod where\n");

  const buildDir = resolve(dir, "_build", "2.9.0", "agda");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(resolve(buildDir, "Mod.agdai"), "fresh");

  // Source older than cache → cache is fresh.
  const tenMinutesAgo = (Date.now() - 10 * 60 * 1000) / 1000;
  utimesSync(sourcePath, tenMinutesAgo, tenMinutesAgo);

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, dir);

  const result = await server.get("agda_cache_info")!.callback({ file: "Mod.agda" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.artifactCount).toBe(1);
  expect(data.freshCount).toBe(1);
  expect(data.staleCount).toBe(0);
  expect(data.hasStaleArtifacts).toBe(false);
  expect(data.artifacts[0].kind).toBe("separated");
  expect(data.artifacts[0].agdaVersion).toBe("2.9.0");
  expect(result.content[0].text).toContain("_build/2.9.0/agda");
  expect(result.content[0].text).toContain("fresh");
});

test("agda_cache_info flags a stale artifact and prints the forceRecompile tip", async () => {
  const dir = resolve(sandbox, "proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(dir, "Mod.agda");
  writeFileSync(sourcePath, "module Mod where\n");

  const buildDir = resolve(dir, "_build", "2.9.0", "agda");
  mkdirSync(buildDir, { recursive: true });
  const cachePath = resolve(buildDir, "Mod.agdai");
  writeFileSync(cachePath, "stale");

  // Cache older than source → stale.
  const tenMinutesAgo = (Date.now() - 10 * 60 * 1000) / 1000;
  utimesSync(cachePath, tenMinutesAgo, tenMinutesAgo);

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, dir);

  const result = await server.get("agda_cache_info")!.callback({ file: "Mod.agda" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.staleCount).toBe(1);
  expect(data.hasStaleArtifacts).toBe(true);
  expect(result.content[0].text).toContain("**stale**");
  expect(result.content[0].text).toContain("forceRecompile: true");
});

test("agda_cache_info reports a local-interface artifact when there is no .agda-lib", async () => {
  const dir = resolve(sandbox, "loose");
  mkdirSync(dir, { recursive: true });
  const sourcePath = resolve(dir, "Loose.agda");
  writeFileSync(sourcePath, "module Loose where\n");
  writeFileSync(resolve(dir, "Loose.agdai"), "local");

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, dir);

  const result = await server.get("agda_cache_info")!.callback({ file: "Loose.agda" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.projectRoot).toBeNull();
  expect(data.artifactCount).toBe(1);
  expect(data.artifacts[0].kind).toBe("local");
  expect(result.content[0].text).toContain("local (next to source)");
});

test("agda_cache_info keeps display paths stable when repoRoot is a symlink", async (ctx: TestContext) => {
  // Regression for PR #44 review comment: when `repoRoot` is a
  // symlink but `filePath` comes back realpath'd from
  // `resolveExistingPathWithinRoot`, naive `relative(repoRoot, filePath)`
  // yields `../private/var/...` garbage. The fix is to compute the
  // display relative against a canonicalized root. This test pins
  // that convention end-to-end by calling the tool through a
  // symlinked repo root and asserting the rendered relative path.
  const realRoot = resolve(sandbox, "real-root");
  const linkedRoot = resolve(sandbox, "linked-root");
  mkdirSync(realRoot, { recursive: true });
  writeFileSync(resolve(realRoot, "proj.agda-lib"), "name: proj\ninclude: .\n");
  writeFileSync(resolve(realRoot, "Mod.agda"), "module Mod where\n");

  try {
    symlinkSync(realRoot, linkedRoot, "dir");
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && ((err as NodeJS.ErrnoException).code === "EPERM" || (err as NodeJS.ErrnoException).code === "EACCES")) {
      ctx.skip();
      return;
    }
    throw err;
  }

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, linkedRoot);

  const result = await server.get("agda_cache_info")!.callback({ file: "Mod.agda" });

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.file).toBe("Mod.agda");
  expect(result.content[0].text).toContain("## Cache info: Mod.agda");
  expect(result.content[0].text).not.toContain("../");
});

test("agda_cache_info refuses paths that escape the repo root", async () => {
  const dir = resolve(sandbox, "proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "proj.agda-lib"), "name: proj\ninclude: .\n");

  const server = createCapturingServer();
  registerCacheTools(server as unknown as McpServer, stubSession, dir);

  const result = await server.get("agda_cache_info")!.callback({ file: "../../etc/passwd" });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-path");
});
