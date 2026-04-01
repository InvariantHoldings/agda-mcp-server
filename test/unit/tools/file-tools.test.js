import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { register as registerFileTools } from "../../../dist/tools/file-tools.js";
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

function ensureRepoSymlink(t) {
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
      const code = error.code;
      if (code === "EPERM" || code === "EACCES") {
        t.skip(`symlink creation is not permitted on this platform: ${code}`);
        return null;
      }
    }
    throw error;
  }

  t.after(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  return { linkedRepoRoot };
}

test("agda_list_modules keeps display paths stable when repoRoot is a symlink", async (t) => {
  clearToolManifest();
  const fixture = ensureRepoSymlink(t);
  if (!fixture) {
    return;
  }

  const server = createCapturingServer();
  registerFileTools(server, {}, fixture.linkedRepoRoot);

  const result = await server.get("agda_list_modules").callback({ tier: "Kernel" });

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /agda\/Kernel\/Example\.agda/);
  assert.equal(result.content[0].text.includes("../"), false);
  assert.equal(result.content[0].text.includes("Leaked.agda"), false);
});

test("agda_search_definitions skips symlinked files that resolve outside the project root", async (t) => {
  clearToolManifest();
  const fixture = ensureRepoSymlink(t);
  if (!fixture) {
    return;
  }

  const server = createCapturingServer();
  registerFileTools(server, {}, fixture.linkedRepoRoot);

  const safeResult = await server.get("agda_search_definitions").callback({
    query: "foo",
    tier: "Kernel",
  });
  assert.equal(safeResult.isError, false);
  assert.match(safeResult.content[0].text, /agda\/Kernel\/Example\.agda:2/);
  assert.equal(safeResult.content[0].text.includes("../"), false);

  const escapedResult = await server.get("agda_search_definitions").callback({
    query: "outsideOnly",
    tier: "Kernel",
  });
  assert.equal(escapedResult.isError, false);
  assert.match(escapedResult.content[0].text, /No matches for "outsideOnly"/);
});
