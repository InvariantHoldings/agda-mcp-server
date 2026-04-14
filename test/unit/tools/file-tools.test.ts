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
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, fixture.linkedRepoRoot);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toMatch(/agda\/Kernel\/Example\.agda/);
    expect(result.content[0].text.includes("../")).toBe(false);
    expect(result.content[0].text.includes("Leaked.agda")).toBe(false);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

function buildLargeKernelFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-list-modules-page-"));
  const kernelDir = join(sandbox, "agda", "Kernel");
  mkdirSync(kernelDir, { recursive: true });
  // Numbered names so a lexicographic sort is predictable across platforms.
  // 60 modules is enough to exercise default-25, default-25-second-page,
  // limit overrides, and the "past the end" case in one fixture.
  for (let i = 0; i < 60; i++) {
    const name = `Module${String(i).padStart(3, "0")}.agda`;
    writeFileSync(
      join(kernelDir, name),
      `module Kernel.Module${String(i).padStart(3, "0")} where\n`,
    );
  }
  return { sandbox };
}

test("agda_list_modules defaults to a 25-module page and reports the total", async () => {
  clearToolManifest();
  const { sandbox } = buildLargeKernelFixture();
  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel" });

    expect(result.isError).toBe(false);
    const text: string = result.content[0].text;
    expect(text).toContain("**Total:** 60 modules");
    expect(text).toContain("**Showing:** 1–25 of 60.");
    expect(text).toContain("Module000.agda");
    expect(text).toContain("Module024.agda");
    expect(text).not.toContain("Module025.agda");
    expect(text).toContain("**More results available.** Re-call with `offset: 25`");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("agda_list_modules honours offset to fetch the next page", async () => {
  clearToolManifest();
  const { sandbox } = buildLargeKernelFixture();
  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel", offset: 25 });

    const text: string = result.content[0].text;
    expect(text).toContain("**Showing:** 26–50 of 60.");
    expect(text).toContain("Module025.agda");
    expect(text).toContain("Module049.agda");
    expect(text).not.toContain("Module024.agda");
    expect(text).not.toContain("Module050.agda");
    expect(text).toContain("offset: 50");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("agda_list_modules last page omits the more-results footer", async () => {
  clearToolManifest();
  const { sandbox } = buildLargeKernelFixture();
  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel", offset: 50 });

    const text: string = result.content[0].text;
    expect(text).toContain("**Showing:** 51–60 of 60.");
    expect(text).toContain("Module059.agda");
    expect(text).not.toContain("More results available");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("agda_list_modules pattern filter is case-insensitive and reports both totals", async () => {
  clearToolManifest();
  const { sandbox } = buildLargeKernelFixture();
  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({
      tier: "Kernel",
      pattern: "MODULE01",
      limit: 100,
    });

    const text: string = result.content[0].text;
    // 10 hits: Module010..Module019
    expect(text).toContain("**Total:** 10 matches for `MODULE01` (out of 60");
    expect(text).toContain("**Showing:** 1–10 of 10.");
    expect(text).toContain("Module010.agda");
    expect(text).toContain("Module019.agda");
    expect(text).not.toContain("Module020.agda");
    expect(text).not.toContain("More results available");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("agda_list_modules keeps walking siblings when one subtree is unreadable", async (ctx) => {
  // Hardening for "one subtree crashes the whole tool" — a bad
  // permission or broken symlink on ONE subdir must not prevent the
  // tool from returning results for all the readable siblings.
  // Uses chmod to force readdir(sub) to fail; if chmod is a no-op
  // on the platform (Windows, some CI sandboxes), the test skips.
  const { chmodSync } = await import("node:fs");
  clearToolManifest();
  const sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-list-modules-walkerr-"));
  try {
    const kernel = join(sandbox, "agda", "Kernel");
    const readable = join(kernel, "Readable");
    const blocked = join(kernel, "Blocked");
    mkdirSync(readable, { recursive: true });
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(readable, "Good.agda"), "module Kernel.Readable.Good where\n");
    writeFileSync(join(blocked, "Hidden.agda"), "module Kernel.Blocked.Hidden where\n");

    try {
      chmodSync(blocked, 0o000);
    } catch {
      ctx.skip();
      return;
    }
    // Sanity-check that the OS actually enforces the permission;
    // some Docker/CI filesystems silently ignore chmod, in which
    // case the test is a no-op rather than a lie.
    try {
      const { readdirSync: rd } = await import("node:fs");
      rd(blocked);
      chmodSync(blocked, 0o700);
      ctx.skip();
      return;
    } catch {
      // Expected — readdir of the blocked dir threw.
    }

    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel" });

    expect(result.isError).toBe(false);
    const text: string = result.content[0].text;
    // The readable sibling still got listed.
    expect(text).toContain("Good.agda");
    expect(text).not.toContain("Hidden.agda");
    // The unreadable subtree is reported as skipped.
    expect(text).toMatch(/Skipped 1 unreadable subtree/);

    chmodSync(blocked, 0o700);
  } finally {
    // Restore any lingering restrictive permission so the rmSync
    // below can remove everything cleanly.
    try {
      chmodSync(join(sandbox, "agda", "Kernel", "Blocked"), 0o700);
    } catch { /* already restored */ }
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("agda_list_modules with offset past the end returns an empty page but keeps the total", async () => {
  clearToolManifest();
  const { sandbox } = buildLargeKernelFixture();
  try {
    const server = createCapturingServer();
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, sandbox);

    const result = await server.get("agda_list_modules")!.callback({ tier: "Kernel", offset: 9999 });

    const text: string = result.content[0].text;
    expect(text).toContain("**Total:** 60 modules");
    expect(text).toContain("**Showing:** none — `offset: 9999` is past the end (60 total).");
    expect(text).not.toContain("More results available");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
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
    registerFileTools(server as unknown as McpServer, { getAgdaVersion: () => null } as any, fixture.linkedRepoRoot);

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
