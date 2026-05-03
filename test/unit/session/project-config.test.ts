import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, expect, afterEach, beforeEach } from "vitest";

import {
  loadProjectConfig,
  mergeCommandLineOptions,
  invalidateProjectConfigCache,
  PROJECT_CONFIG_FILENAME,
  ENV_DEFAULT_FLAGS,
} from "../../../src/session/project-config.js";

let tempDirs: string[] = [];
let originalEnv: string | undefined;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-config-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalEnv = process.env[ENV_DEFAULT_FLAGS];
  delete process.env[ENV_DEFAULT_FLAGS];
  invalidateProjectConfigCache();
});

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
  if (originalEnv !== undefined) {
    process.env[ENV_DEFAULT_FLAGS] = originalEnv;
  } else {
    delete process.env[ENV_DEFAULT_FLAGS];
  }
  invalidateProjectConfigCache();
});

// ── loadProjectConfig ────────────────────────────────────────────────

test("returns empty config when no config file exists", () => {
  const dir = makeTempDir();
  const config = loadProjectConfig(dir);
  expect(config).toEqual({});
});

test("reads commandLineOptions from .agda-mcp.json", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--safe"] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toEqual(["--Werror", "--safe"]);
});

test("returns empty config for invalid JSON", () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), "not json");
  const config = loadProjectConfig(dir);
  expect(config).toEqual({});
});

test("returns empty config for non-object JSON", () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify([1, 2, 3]));
  const config = loadProjectConfig(dir);
  expect(config).toEqual({});
});

test("ignores invalid commandLineOptions type", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: "not-an-array" }),
  );
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toBeUndefined();
});

test("ignores commandLineOptions with non-string elements", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe", 42] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toBeUndefined();
});

// ── Caching ──────────────────────────────────────────────────────────

test("caches config and returns same result on repeated calls", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  const first = loadProjectConfig(dir);
  const second = loadProjectConfig(dir);
  expect(first).toEqual(second);
  expect(first.commandLineOptions).toEqual(["--safe"]);
});

test("invalidateProjectConfigCache clears the cache", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  loadProjectConfig(dir);
  // Update file content
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror"] }),
  );
  // Force invalidation (normally mtime change would trigger)
  invalidateProjectConfigCache(dir);
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toEqual(["--Werror"]);
});

// ── AGDA_MCP_DEFAULT_FLAGS env var ───────────────────────────────────

test("reads flags from AGDA_MCP_DEFAULT_FLAGS env var", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "--Werror --safe";
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toEqual(["--Werror", "--safe"]);
});

test("merges env var flags with file-based config", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--without-K"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--Werror";
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toEqual(["--without-K", "--Werror"]);
});

test("env var with extra whitespace is parsed correctly", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "  --safe   --Werror  ";
  const config = loadProjectConfig(dir);
  expect(config.commandLineOptions).toEqual(["--safe", "--Werror"]);
});

test("empty env var produces no flags", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "";
  const config = loadProjectConfig(dir);
  expect(config).toEqual({});
});

// ── mergeCommandLineOptions ──────────────────────────────────────────

test("returns empty array when both inputs are undefined", () => {
  expect(mergeCommandLineOptions(undefined, undefined)).toEqual([]);
});

test("returns project defaults when per-call is undefined", () => {
  expect(mergeCommandLineOptions(["--safe"], undefined)).toEqual(["--safe"]);
});

test("returns per-call options when project defaults are undefined", () => {
  expect(mergeCommandLineOptions(undefined, ["--Werror"])).toEqual(["--Werror"]);
});

test("merges project defaults and per-call options", () => {
  const result = mergeCommandLineOptions(["--safe"], ["--Werror"]);
  expect(result).toEqual(["--safe", "--Werror"]);
});

test("deduplicates with per-call taking precedence (last occurrence kept)", () => {
  const result = mergeCommandLineOptions(
    ["--safe", "--Werror"],
    ["--without-K", "--safe"],
  );
  // --safe appears in both; per-call is last so it's kept at its per-call position
  expect(result).toEqual(["--Werror", "--without-K", "--safe"]);
});
