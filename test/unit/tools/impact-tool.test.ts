import type { TestContext } from "vitest";
import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerImpactTool } from "../../../src/tools/impact-tool.js";
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
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-impact-"));
  clearToolManifest();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function writeAgda(rel: string, content: string): void {
  const abs = resolve(sandbox, rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

test("agda_impact reports direct + transitive dependents on a chain", async () => {
  writeAgda("Leaf.agda", "module Leaf where\nx : Set\nx = Set\n");
  writeAgda("Mid.agda", "module Mid where\nopen import Leaf\n");
  writeAgda("Top.agda", "module Top where\nopen import Mid\n");

  const server = createCapturingServer();
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);

  const result = await server.get("agda_impact")!.callback({ file: "Leaf.agda" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.directDependents).toEqual(["Mid.agda"]);
  expect(data.transitiveDependents).toEqual(["Mid.agda", "Top.agda"]);
  expect(data.directDependencies).toEqual([]);
  expect(data.transitiveDependencies).toEqual([]);
  expect(data.graphSize).toBe(3);

  const text = result.content[0].text;
  expect(text).toContain("**Direct dependents:** 1");
  expect(text).toContain("**Transitive dependents:** 2");
  expect(text).toContain("- Mid.agda");
  expect(text).toContain("- Top.agda");
});

test("agda_impact reports dependencies for a top-of-chain consumer", async () => {
  writeAgda("Leaf.agda", "module Leaf where\n");
  writeAgda("Mid.agda", "module Mid where\nopen import Leaf\n");
  writeAgda("Top.agda", "module Top where\nopen import Mid\nopen import Leaf\n");

  const server = createCapturingServer();
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);

  const result = await server.get("agda_impact")!.callback({ file: "Top.agda" });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  expect(data.directDependencies).toEqual(["Leaf.agda", "Mid.agda"]);
  expect(data.transitiveDependencies).toEqual(["Leaf.agda", "Mid.agda"]);
  expect(data.directDependents).toEqual([]);
  expect(data.transitiveDependents).toEqual([]);
});

test("agda_impact returns not-in-graph for a non-Agda file under the root", async () => {
  // A README is excluded from the graph because it's not an Agda
  // source — the tool should say so explicitly rather than reporting
  // empty results, which would be ambiguous between "no edges" and
  // "not part of the graph at all".
  writeAgda("Active.agda", "module Active where\n");
  writeAgda("README.txt", "this is not an Agda file\n");

  const server = createCapturingServer();
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);

  const result = await server.get("agda_impact")!.callback({ file: "README.txt" });

  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("not-in-graph");
});

test("agda_impact keeps display paths stable when repoRoot is a symlink", async (ctx: TestContext) => {
  // Regression for PR #44 review comment: the not-in-graph error
  // fallback and the "graph size" rendering both used to compute
  // relative paths against the non-canonicalized `repoRoot`. When
  // `repoRoot` is a symlink and `filePath` is realpath'd, that
  // produced `../private/var/...` garbage on macOS. The happy path
  // is also validated here: the structured `data.file` and the
  // rendered heading must both be the short relative name.
  const realRoot = resolve(sandbox, "real-root");
  const linkedRoot = resolve(sandbox, "linked-root");
  mkdirSync(realRoot, { recursive: true });
  writeFileSync(resolve(realRoot, "Leaf.agda"), "module Leaf where\n");
  writeFileSync(resolve(realRoot, "Mid.agda"), "module Mid where\nopen import Leaf\n");

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
  registerImpactTool(server as unknown as McpServer, stubSession, linkedRoot);

  const result = await server.get("agda_impact")!.callback({ file: "Leaf.agda" });

  expect(result.isError).toBe(false);
  expect(result.structuredContent.data.file).toBe("Leaf.agda");
  expect(result.structuredContent.data.directDependents).toEqual(["Mid.agda"]);
  const text: string = result.content[0].text;
  expect(text).toContain("## Impact: Leaf.agda");
  expect(text).not.toContain("../");
  // §3: graph-size line must print a real root, not a stale `.`.
  expect(text).toMatch(/\*\*Graph size:\*\* 2 module\(s\) scanned under `[^`]+real-root`/);
});

test("agda_impact rejects paths that escape the repo root", async () => {
  writeAgda("Active.agda", "module Active where\n");

  const server = createCapturingServer();
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);

  const result = await server.get("agda_impact")!.callback({ file: "../../etc/passwd" });
  expect(result.isError).toBe(true);
  expect(result.structuredContent.classification).toBe("invalid-path");
});

test("agda_impact `limit` truncates the rendered list but keeps the structured arrays full", async () => {
  // Leaf with 60 direct dependents.
  writeAgda("Leaf.agda", "module Leaf where\n");
  for (let i = 0; i < 60; i++) {
    const name = `Dep${String(i).padStart(3, "0")}`;
    writeAgda(`${name}.agda`, `module ${name} where\nopen import Leaf\n`);
  }

  const server = createCapturingServer();
  registerImpactTool(server as unknown as McpServer, stubSession, sandbox);

  const result = await server.get("agda_impact")!.callback({ file: "Leaf.agda", limit: 10 });

  expect(result.isError).toBe(false);
  const data = result.structuredContent.data;
  // Structured field is unbounded.
  expect(data.directDependents.length).toBe(60);
  expect(data.directDependentCount).toBe(60);

  // Rendered list is truncated to 10 with a footer.
  const text = result.content[0].text;
  expect(text).toContain("- Dep000.agda");
  expect(text).toContain("- Dep009.agda");
  expect(text).not.toContain("- Dep010.agda");
  expect(text).toContain("…and 50 more");
});
