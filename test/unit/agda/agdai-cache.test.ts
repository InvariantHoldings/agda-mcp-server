import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  bustAgdaiCache,
  findAgdaProjectRoot,
  findAgdaiArtifacts,
} from "../../../src/agda/agdai-cache.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agda-mcp-agdai-cache-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ── findAgdaProjectRoot ────────────────────────────────────────────

test("findAgdaProjectRoot returns the closest ancestor with an .agda-lib", () => {
  const root = resolve(sandbox, "proj");
  const sub = resolve(root, "agda", "Sub");
  mkdirSync(sub, { recursive: true });
  writeFileSync(resolve(root, "proj.agda-lib"), "name: proj\ninclude: agda\n");
  writeFileSync(resolve(sub, "Mod.agda"), "module Sub.Mod where\n");

  const found = findAgdaProjectRoot(resolve(sub, "Mod.agda"), sandbox);
  expect(found).toBe(root);
});

test("findAgdaProjectRoot returns null when no ancestor has an .agda-lib", () => {
  const dir = resolve(sandbox, "loose");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "Loose.agda"), "module Loose where\n");

  const found = findAgdaProjectRoot(resolve(dir, "Loose.agda"), sandbox);
  expect(found).toBeNull();
});

test("findAgdaProjectRoot ignores stray _build/ directories without an .agda-lib", () => {
  // Defensive: a leftover _build/ from a sibling project must not be
  // misidentified as the current source's project root, otherwise the
  // cache search would scan the wrong tree. Mirrors the behaviour of
  // Agda's own findProjectConfig which only inspects .agda-lib files.
  const dir = resolve(sandbox, "with-build");
  mkdirSync(resolve(dir, "_build", "2.9.0", "agda"), { recursive: true });
  writeFileSync(resolve(dir, "WithBuild.agda"), "module WithBuild where\n");

  const found = findAgdaProjectRoot(resolve(dir, "WithBuild.agda"), sandbox);
  expect(found).toBeNull();
});

// ── findAgdaiArtifacts ─────────────────────────────────────────────

test("findAgdaiArtifacts discovers a separated interface under _build/<version>/agda", () => {
  const root = resolve(sandbox, "proj");
  const sub = resolve(root, "agda", "Sub");
  mkdirSync(sub, { recursive: true });
  writeFileSync(resolve(root, "proj.agda-lib"), "name: proj\ninclude: agda\n");
  const sourcePath = resolve(sub, "Mod.agda");
  writeFileSync(sourcePath, "module Sub.Mod where\n");

  // Plant a fake .agdai matching Agda's exact storage formula:
  // <root>/_build/<version>/agda/<rel>.agdai where rel is relative to root.
  const artifactDir = resolve(root, "_build", "2.9.0", "agda", "agda", "Sub");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolve(artifactDir, "Mod.agdai");
  writeFileSync(artifactPath, "fake interface bytes");

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0].kind).toBe("separated");
  expect(artifacts[0].path).toBe(artifactPath);
  expect(artifacts[0].agdaVersion).toBe("2.9.0");
});

test("findAgdaiArtifacts surfaces multiple version subdirs under one project root", () => {
  const root = resolve(sandbox, "proj");
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(root, "Mod.agda");
  writeFileSync(sourcePath, "module Mod where\n");

  for (const version of ["2.8.0", "2.9.0", "2.9.1"]) {
    const dir = resolve(root, "_build", version, "agda");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "Mod.agdai"), "fake");
  }

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts.map((a) => a.agdaVersion).sort()).toEqual(["2.8.0", "2.9.0", "2.9.1"]);
  for (const a of artifacts) expect(a.kind).toBe("separated");
});

test("findAgdaiArtifacts discovers a local-interface fallback next to the source", () => {
  // No .agda-lib anywhere → Agda uses the local-interface fallback,
  // putting Hello.agdai right next to Hello.agda. We must report it
  // even though there's no project root.
  const dir = resolve(sandbox, "loose");
  mkdirSync(dir, { recursive: true });
  const sourcePath = resolve(dir, "Hello.agda");
  writeFileSync(sourcePath, "module Hello where\n");
  const localPath = resolve(dir, "Hello.agdai");
  writeFileSync(localPath, "fake interface bytes");

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0].kind).toBe("local");
  expect(artifacts[0].path).toBe(localPath);
  expect(artifacts[0].agdaVersion).toBeNull();
});

test("findAgdaiArtifacts can return both a separated and a local artifact for one source", () => {
  // Agda warns DuplicateInterfaceFiles in this case but BOTH files
  // exist on disk, so cache busting must remove both.
  const root = resolve(sandbox, "proj");
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(root, "Mod.agda");
  writeFileSync(sourcePath, "module Mod where\n");

  const buildDir = resolve(root, "_build", "2.9.0", "agda");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(resolve(buildDir, "Mod.agdai"), "separated");
  writeFileSync(resolve(root, "Mod.agdai"), "local");

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  const kinds = artifacts.map((a) => a.kind).sort();
  expect(kinds).toEqual(["local", "separated"]);
});

test("findAgdaiArtifacts marks an artifact stale when the source is newer than the cache", () => {
  const dir = resolve(sandbox, "loose");
  mkdirSync(dir, { recursive: true });
  const sourcePath = resolve(dir, "Stale.agda");
  writeFileSync(sourcePath, "module Stale where\n");
  const cachePath = resolve(dir, "Stale.agdai");
  writeFileSync(cachePath, "old cache");

  // Set cache mtime to "yesterday" and source mtime to "now" so the
  // cache is unambiguously older.
  const tenMinutesAgo = (Date.now() - 10 * 60 * 1000) / 1000;
  utimesSync(cachePath, tenMinutesAgo, tenMinutesAgo);

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0].fresh).toBe(false);
});

test("findAgdaiArtifacts marks an artifact fresh when the cache is at least as new as the source", () => {
  const dir = resolve(sandbox, "loose");
  mkdirSync(dir, { recursive: true });
  const sourcePath = resolve(dir, "Fresh.agda");
  writeFileSync(sourcePath, "module Fresh where\n");
  const cachePath = resolve(dir, "Fresh.agdai");
  writeFileSync(cachePath, "fresh cache");

  // Set source mtime to ten minutes ago, cache mtime to now.
  const tenMinutesAgo = (Date.now() - 10 * 60 * 1000) / 1000;
  utimesSync(sourcePath, tenMinutesAgo, tenMinutesAgo);

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0].fresh).toBe(true);
});

test("findAgdaiArtifacts respects the longest-suffix swap for literate sources", () => {
  // .lagda.md must collapse to .agdai (not .lagda.agdai).
  const dir = resolve(sandbox, "literate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(dir, "Doc.lagda.md");
  writeFileSync(sourcePath, "# header\n```agda\nmodule Doc where\n```\n");

  const buildDir = resolve(dir, "_build", "2.9.0", "agda");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(resolve(buildDir, "Doc.agdai"), "literate cache");

  const artifacts = findAgdaiArtifacts(sourcePath, sandbox);
  expect(artifacts.map((a) => a.path)).toContain(resolve(buildDir, "Doc.agdai"));
});

// ── bustAgdaiCache ─────────────────────────────────────────────────

test("bustAgdaiCache removes both separated and local artifacts and reports the deleted paths", () => {
  const root = resolve(sandbox, "proj");
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, "proj.agda-lib"), "name: proj\ninclude: .\n");
  const sourcePath = resolve(root, "Mod.agda");
  writeFileSync(sourcePath, "module Mod where\n");

  const buildDir = resolve(root, "_build", "2.9.0", "agda");
  mkdirSync(buildDir, { recursive: true });
  const sepPath = resolve(buildDir, "Mod.agdai");
  const localPath = resolve(root, "Mod.agdai");
  writeFileSync(sepPath, "sep");
  writeFileSync(localPath, "local");

  const removed = bustAgdaiCache(sourcePath, sandbox);
  expect(removed.sort()).toEqual([localPath, sepPath].sort());

  // After busting, neither artifact should still be discoverable.
  expect(findAgdaiArtifacts(sourcePath, sandbox)).toEqual([]);
});

test("bustAgdaiCache returns an empty list when no artifacts exist", () => {
  const dir = resolve(sandbox, "cold");
  mkdirSync(dir, { recursive: true });
  const sourcePath = resolve(dir, "Cold.agda");
  writeFileSync(sourcePath, "module Cold where\n");

  const removed = bustAgdaiCache(sourcePath, sandbox);
  expect(removed).toEqual([]);
});
