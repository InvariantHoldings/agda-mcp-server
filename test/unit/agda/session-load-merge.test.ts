// MIT License — see LICENSE
//
// Verifies that AgdaSession.load() merges project-level defaults
// (.agda-mcp.json + AGDA_MCP_DEFAULT_FLAGS) with per-call options on
// every load, so internal callers (agda_apply_edit's reload,
// agda_bulk_status, etc.) get project defaults applied without each
// having to re-implement the merge.

import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import { AgdaSession } from "../../../src/agda-process.js";
import {
  ENV_DEFAULT_FLAGS,
  PROJECT_CONFIG_FILENAME,
  invalidateProjectConfigCache,
} from "../../../src/session/project-config.js";

let tempDirs: string[] = [];
let savedEnv: string | undefined;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agda-mcp-merge-"));
  tempDirs.push(dir);
  return dir;
}

function writeTestFile(root: string): string {
  const file = join(root, "Test.agda");
  writeFileSync(file, "module Test where\n");
  return file;
}

function makeStubbedSession(root: string, capturedCmds: string[]): AgdaSession {
  const session = new AgdaSession(root);
  session["versionDetectionAttempts"] = AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;
  session["transport"].sendCommand = async function (_proc, command) {
    capturedCmds.push(command);
    return [
      { kind: "InteractionPoints", interactionPoints: [] },
      {
        kind: "DisplayInfo",
        info: {
          kind: "AllGoalsWarnings",
          visibleGoals: [],
          invisibleGoals: [],
          errors: [],
          warnings: [],
        },
      },
      { kind: "Status", checked: true },
    ];
  };
  session.ensureProcess = () => ({ exitCode: null } as unknown as ChildProcess);
  return session;
}

function findLoadCmd(cmds: string[]): string {
  return cmds.find((c) => c.includes("Cmd_load")) ?? "";
}

beforeEach(() => {
  savedEnv = process.env[ENV_DEFAULT_FLAGS];
  delete process.env[ENV_DEFAULT_FLAGS];
  invalidateProjectConfigCache();
});

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
  if (savedEnv !== undefined) {
    process.env[ENV_DEFAULT_FLAGS] = savedEnv;
  } else {
    delete process.env[ENV_DEFAULT_FLAGS];
  }
  invalidateProjectConfigCache();
});

test("session.load() merges .agda-mcp.json flags into the IOTCM command", async () => {
  const root = makeTempDir();
  writeFileSync(
    join(root, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "--safe"] }),
  );
  const file = writeTestFile(root);
  const cmds: string[] = [];
  const session = makeStubbedSession(root, cmds);

  await session.load(file);
  const loadCmd = findLoadCmd(cmds);
  expect(loadCmd).toContain('"--Werror"');
  expect(loadCmd).toContain('"--safe"');
});

test("session.load() merges AGDA_MCP_DEFAULT_FLAGS into the IOTCM command without per-call options", async () => {
  const root = makeTempDir();
  process.env[ENV_DEFAULT_FLAGS] = "--without-K --erasure";
  invalidateProjectConfigCache();
  const file = writeTestFile(root);
  const cmds: string[] = [];
  const session = makeStubbedSession(root, cmds);

  await session.load(file);
  const loadCmd = findLoadCmd(cmds);
  expect(loadCmd).toContain('"--without-K"');
  expect(loadCmd).toContain('"--erasure"');
});

test("session.load() per-call options win on collision (last-wins dedup)", async () => {
  // The merge result must dedupe so the same flag isn't emitted twice
  // — Agda would parse it as two separate flags but the dup is wasteful
  // on the wire and confusing in logs.
  const root = makeTempDir();
  writeFileSync(
    join(root, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--safe"] }),
  );
  const file = writeTestFile(root);
  const cmds: string[] = [];
  const session = makeStubbedSession(root, cmds);

  await session.load(file, { commandLineOptions: ["--safe", "--Werror"] });
  const loadCmd = findLoadCmd(cmds);
  // --safe appears exactly once, even though it came from both layers.
  const safeCount = (loadCmd.match(/"--safe"/gu) ?? []).length;
  expect(safeCount).toBe(1);
  expect(loadCmd).toContain('"--Werror"');
});

test("session.load() returns projectConfigWarnings when config has issues", async () => {
  const root = makeTempDir();
  writeFileSync(
    join(root, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror", "bad-flag"], typo: 1 }),
  );
  const file = writeTestFile(root);
  const cmds: string[] = [];
  const session = makeStubbedSession(root, cmds);

  const result = await session.load(file);
  expect(result.projectConfigWarnings).toBeDefined();
  expect(result.projectConfigWarnings!.length).toBeGreaterThanOrEqual(2);
  const messages = result.projectConfigWarnings!.map((w) => w.message);
  expect(messages.some((m) => m.includes("Unknown key 'typo'"))).toBe(true);
  expect(messages.some((m) => m.includes("must start with '-'"))).toBe(true);
  const loadCmd = findLoadCmd(cmds);
  // The valid flag still made it through.
  expect(loadCmd).toContain('"--Werror"');
  // The bad flag was dropped, not passed.
  expect(loadCmd).not.toContain("bad-flag");
});

test("session.load() omits projectConfigWarnings when config is clean", async () => {
  const root = makeTempDir();
  writeFileSync(
    join(root, PROJECT_CONFIG_FILENAME),
    JSON.stringify({ commandLineOptions: ["--Werror"] }),
  );
  const file = writeTestFile(root);
  const cmds: string[] = [];
  const session = makeStubbedSession(root, cmds);

  const result = await session.load(file);
  expect(result.projectConfigWarnings).toBeUndefined();
});
