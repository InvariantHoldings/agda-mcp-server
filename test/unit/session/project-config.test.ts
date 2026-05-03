import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, expect, afterEach, beforeEach } from "vitest";

import {
  effectiveProjectFlags,
  loadProjectConfig,
  mergeCommandLineOptions,
  invalidateProjectConfigCache,
  parseEnvFlags,
  PROJECT_CONFIG_FILENAME,
  ENV_DEFAULT_FLAGS,
  MAX_CONFIG_FILE_BYTES,
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

// ── loadProjectConfig — basic shapes ─────────────────────────────────

test("returns empty fileFlags/envFlags when no config file and no env var", () => {
  const dir = makeTempDir();
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.envFlags).toEqual([]);
  expect(config.warnings).toEqual([]);
  expect(config.configFilePath).toBeUndefined();
});

test("reads commandLineOptions from .agda-mcp.json into fileFlags", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--safe"] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--Werror", "--safe"]);
  expect(config.envFlags).toEqual([]);
  expect(config.warnings).toEqual([]);
  expect(config.configFilePath).toBe(join(dir, PROJECT_CONFIG_FILENAME));
});

test("emits warning for invalid JSON without throwing", () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), "not json");
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.warnings.length).toBeGreaterThanOrEqual(1);
  expect(config.warnings[0].source).toBe("file");
  expect(config.warnings[0].message).toMatch(/Invalid JSON/);
});

test("emits warning for non-object JSON", () => {
  const dir = makeTempDir();
  writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify([1, 2, 3]));
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.warnings.some((w) => w.message.includes("expected a top-level JSON object"))).toBe(true);
});

test("emits warning for invalid commandLineOptions type (string instead of array)", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: "not-an-array" }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.warnings.some((w) => w.message.includes("must be an array of strings"))).toBe(true);
});

test("emits per-element warning for non-string entries and keeps the valid ones", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe", 42, "--Werror", null] }),
  );
  const config = loadProjectConfig(dir);
  // Valid string flags survive — dropping the whole array would lose
  // good config because of one bad entry.
  expect(config.fileFlags).toEqual(["--safe", "--Werror"]);
  // One warning per offending element, with its index.
  const offenderWarnings = config.warnings.filter((w) =>
    w.message.includes("'commandLineOptions[")
  );
  expect(offenderWarnings.length).toBe(2);
  expect(offenderWarnings.some((w) => w.message.includes("commandLineOptions[1]"))).toBe(true);
  expect(offenderWarnings.some((w) => w.message.includes("commandLineOptions[3]"))).toBe(true);
  // Type label tells the user *what* the bad entry was.
  expect(offenderWarnings.some((w) => w.message.includes("got number"))).toBe(true);
  expect(offenderWarnings.some((w) => w.message.includes("got null"))).toBe(true);
});

test("non-string-only commandLineOptions yields zero fileFlags but warns per element", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: [1, 2, true, {}, []] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  // 5 element-level warnings, one per offender.
  const offenderWarnings = config.warnings.filter((w) =>
    w.message.includes("'commandLineOptions[")
  );
  expect(offenderWarnings.length).toBe(5);
  // Type labels distinguish primitive cases from object/array cases.
  expect(offenderWarnings.some((w) => w.message.includes("got boolean"))).toBe(true);
  expect(offenderWarnings.some((w) => w.message.includes("got object"))).toBe(true);
  expect(offenderWarnings.some((w) => w.message.includes("got array"))).toBe(true);
});

test("emits warning for invalid (blocked/non-flag) entries inside file commandLineOptions", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--interaction-json", "bare-string"] }),
  );
  const config = loadProjectConfig(dir);
  // Valid flags survive; bad flags surface as warnings.
  expect(config.fileFlags).toEqual(["--Werror"]);
  expect(config.warnings.some((w) => w.message.includes("conflicts with the MCP server"))).toBe(true);
  expect(config.warnings.some((w) => w.message.includes("must start with '-'"))).toBe(true);
});

test("emits warning for unknown top-level keys", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandlineoptions: ["--safe"], extras: 1 }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.warnings.some((w) => w.message.includes("Unknown key 'commandlineoptions'"))).toBe(true);
  expect(config.warnings.some((w) => w.message.includes("Unknown key 'extras'"))).toBe(true);
});

test("unknown-key warning includes 'Did you mean ...?' for case-typo of commandLineOptions", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandlineoptions: ["--safe"] }),
  );
  const config = loadProjectConfig(dir);
  const warning = config.warnings.find((w) =>
    w.message.includes("Unknown key 'commandlineoptions'"),
  );
  expect(warning).toBeDefined();
  expect(warning!.message).toContain("Did you mean 'commandLineOptions'?");
});

test("unknown-key warning includes 'Did you mean ...?' for near-misses", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOption: ["--safe"] }), // missing trailing 's'
  );
  const config = loadProjectConfig(dir);
  const warning = config.warnings.find((w) =>
    w.message.includes("Unknown key 'commandLineOption'"),
  );
  expect(warning).toBeDefined();
  expect(warning!.message).toContain("Did you mean 'commandLineOptions'?");
});

test("unknown-key warning omits 'Did you mean' for far-away keys", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ totallyUnrelatedKey: 1 }),
  );
  const config = loadProjectConfig(dir);
  const warning = config.warnings.find((w) =>
    w.message.includes("Unknown key 'totallyUnrelatedKey'"),
  );
  expect(warning).toBeDefined();
  expect(warning!.message).not.toContain("Did you mean");
});

test("$schema key is silently accepted", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({
      $schema: "https://example.com/agda-mcp.schema.json",
      commandLineOptions: ["--safe"],
    }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--safe"]);
  expect(config.warnings).toEqual([]);
});

test("strips UTF-8 BOM before parsing", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    "﻿" + JSON.stringify({ commandLineOptions: ["--Werror"] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--Werror"]);
  expect(config.warnings).toEqual([]);
});

test("readFileSync failure (e.g. .agda-mcp.json is a directory) emits a system-source warning", () => {
  // Inducing a real `EACCES` portably is hard, so use the next-best
  // failure mode: make `.agda-mcp.json` a directory. `existsSync`
  // returns true, `statSync` succeeds (returns a directory stat),
  // but `readFileSync` errors with `EISDIR`. The warning must be
  // tagged `system` — the JSON isn't malformed, the filesystem is.
  const dir = makeTempDir();
  const configPath = join(dir, PROJECT_CONFIG_FILENAME);
  mkdirSync(configPath);
  const config = loadProjectConfig(dir);
  const systemWarnings = config.warnings.filter((w) => w.source === "system");
  expect(systemWarnings.length).toBeGreaterThanOrEqual(1);
  expect(systemWarnings[0].message).toContain(".agda-mcp.json");
  // No `file` source warning was added — content errors and system
  // errors are routed separately.
  const fileWarnings = config.warnings.filter((w) => w.source === "file");
  expect(fileWarnings.length).toBe(0);
});

test("oversize config produces a warning and zero fileFlags", () => {
  const dir = makeTempDir();
  // Build a JSON object whose serialized form is bigger than the cap.
  const giant = "x".repeat(MAX_CONFIG_FILE_BYTES + 100);
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: [`--${giant}`] }),
  );
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.warnings.some((w) => /refusing to read files larger than/.test(w.message))).toBe(true);
});

// ── Caching ──────────────────────────────────────────────────────────

test("caches config and returns same fileFlags on repeated calls", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  const first = loadProjectConfig(dir);
  const second = loadProjectConfig(dir);
  expect(first.fileFlags).toEqual(second.fileFlags);
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
  // Force invalidation (normally mtime/size change would trigger).
  invalidateProjectConfigCache(dir);
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--Werror"]);
});

test("cache invalidates on file size change even with same mtime", () => {
  const dir = makeTempDir();
  const path = join(dir, PROJECT_CONFIG_FILENAME);
  writeFileSync(path, JSON.stringify({ commandLineOptions: ["--safe"] }));
  const first = loadProjectConfig(dir);
  expect(first.fileFlags).toEqual(["--safe"]);
  const stat = statSync(path);

  // Rewrite a different-size payload but force the mtime back to the
  // original to prove that size alone busts the cache (defends against
  // filesystems where mtime resolution is coarse, e.g. ext3, FAT32).
  writeFileSync(path, JSON.stringify({ commandLineOptions: ["--Werror", "--safe"] }));
  utimesSync(path, stat.atime, stat.mtime);

  const second = loadProjectConfig(dir);
  expect(second.fileFlags).toEqual(["--Werror", "--safe"]);
});

test("cache is cleared when file is removed between calls", () => {
  const dir = makeTempDir();
  const path = join(dir, PROJECT_CONFIG_FILENAME);
  writeFileSync(path, JSON.stringify({ commandLineOptions: ["--safe"] }));
  const first = loadProjectConfig(dir);
  expect(first.fileFlags).toEqual(["--safe"]);
  rmSync(path);
  const second = loadProjectConfig(dir);
  expect(second.fileFlags).toEqual([]);
  expect(second.configFilePath).toBeUndefined();
});

// ── AGDA_MCP_DEFAULT_FLAGS env var ───────────────────────────────────

test("reads flags from AGDA_MCP_DEFAULT_FLAGS env var into envFlags", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "--Werror --safe";
  const config = loadProjectConfig(dir);
  expect(config.envFlags).toEqual(["--Werror", "--safe"]);
  expect(config.fileFlags).toEqual([]);
});

test("merges env var flags with file-based config but keeps them in separate buckets", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--without-K"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--Werror";
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--without-K"]);
  expect(config.envFlags).toEqual(["--Werror"]);
});

test("env var with extra whitespace is parsed correctly", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "  --safe   --Werror  ";
  const config = loadProjectConfig(dir);
  expect(config.envFlags).toEqual(["--safe", "--Werror"]);
});

test("empty env var produces no flags and no warnings", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "";
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual([]);
  expect(config.envFlags).toEqual([]);
  expect(config.warnings).toEqual([]);
});

test("env var with invalid flag emits warning and drops the bad flag", () => {
  const dir = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "--safe --interaction-json --Werror";
  const config = loadProjectConfig(dir);
  expect(config.envFlags).toEqual(["--safe", "--Werror"]);
  expect(config.warnings.some((w) =>
    w.source === "env" && w.message.includes("conflicts with the MCP server")
  )).toBe(true);
});

test("flag in BOTH file and env stays attributed to its true source", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe", "--without-K"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--safe --Werror";
  const config = loadProjectConfig(dir);
  expect(config.fileFlags).toEqual(["--safe", "--without-K"]);
  expect(config.envFlags).toEqual(["--safe", "--Werror"]);
});

// ── effectiveProjectFlags ─────────────────────────────────────────────

test("effectiveProjectFlags concatenates file then env (no dedup at this layer)", () => {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  process.env[ENV_DEFAULT_FLAGS] = "--Werror";
  const config = loadProjectConfig(dir);
  expect(effectiveProjectFlags(config)).toEqual(["--safe", "--Werror"]);
});

// ── parseEnvFlags ─────────────────────────────────────────────────────

test("parseEnvFlags handles tabs and newlines", () => {
  process.env[ENV_DEFAULT_FLAGS] = "--safe\t--Werror\n--without-K";
  expect(parseEnvFlags()).toEqual(["--safe", "--Werror", "--without-K"]);
});

test("parseEnvFlags returns [] for unset env", () => {
  delete process.env[ENV_DEFAULT_FLAGS];
  expect(parseEnvFlags()).toEqual([]);
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
