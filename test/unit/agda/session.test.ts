import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgdaSession, findAgdaBinary } from "../../../src/agda-process.js";

test("findAgdaBinary returns pinned script when present", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-server-"));

  try {
    mkdirSync(join(repoRoot, "tooling", "scripts"), { recursive: true });
    const pinned = join(repoRoot, "tooling", "scripts", "run-pinned-agda.sh");
    writeFileSync(pinned, "#!/bin/sh\nexit 0\n", "utf8");
    expect(findAgdaBinary(repoRoot)).toBe(pinned);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("findAgdaBinary falls back to agda when no pinned script exists", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agda-mcp-server-"));

  try {
    expect(findAgdaBinary(repoRoot)).toBe("agda");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("AgdaSession destroy resets mutable session state", () => {
  const session = new AgdaSession(process.cwd());

  session.currentFile = "/tmp/Example.agda";
  session.goalIds = [1, 2, 3];
  session.buffer = "pending";
  session.responseQueue = [{ kind: "Status" }];

  session.destroy();

  expect(session.getLoadedFile()).toBe(null);
  expect(session.getGoalIds()).toEqual([]);
  expect(session.buffer).toBe("");
  expect(session.responseQueue).toEqual([]);
});

test("AgdaSession syncGoalIdsFromResponses applies explicit goal-state updates", () => {
  const session = new AgdaSession(process.cwd());

  session.goalIds = [1, 2, 3];
  session.syncGoalIdsFromResponses([
    { kind: "InteractionPoints", interactionPoints: [4, 5] },
  ]);

  expect(session.getGoalIds()).toEqual([4, 5]);
});

test("AgdaSession forwards legacy backend compatibility methods", async () => {
  const session = new AgdaSession(process.cwd());
  const calls: unknown[][] = [];

  (session as any).backend = {
    compile: async (backendExpr: string, filePath: string, argv: string[]) => {
      calls.push(["compile", backendExpr, filePath, argv]);
      return { kind: "compile" };
    },
    top: async (backendExpr: string, payload: string) => {
      calls.push(["top", backendExpr, payload]);
      return { kind: "top" };
    },
    hole: async (goalId: number, holeContents: string, backendExpr: string, payload: string) => {
      calls.push(["hole", goalId, holeContents, backendExpr, payload]);
      return { kind: "hole" };
    },
  };

  expect(await session.compile("GHC", "/tmp/Test.agda", ["--flag"])).toEqual({ kind: "compile" });
  expect(await session.backendTop("GHC", "ping")).toEqual({ kind: "top" });
  expect(await session.backendHole(7, "", "GHC", "pong")).toEqual({ kind: "hole" });
  expect(calls).toEqual([
    ["compile", "GHC", "/tmp/Test.agda", ["--flag"]],
    ["top", "GHC", "ping"],
    ["hole", 7, "", "GHC", "pong"],
  ]);
});
