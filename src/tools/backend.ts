// MIT License — see LICENSE
//
// Backend command tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession } from "../agda-process.js";
import { wrapGoalHandler, text } from "./tool-helpers.js";

function backendExpressionHelp(): string {
  return "Backend constructor expression (for example: GHC, GHCNoMain, LaTeX, QuickLaTeX, or OtherBackend \"JS\").";
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "agda_compile",
    "Compile a module through Agda's Cmd_compile command using a selected backend.",
    {
      backend: z.string().describe(backendExpressionHelp()),
      file: z.string().describe("Path to the .agda file to compile (relative to repo root or absolute)"),
      args: z.array(z.string()).optional().describe("Optional Agda CLI arguments for the compile command"),
    },
    async ({ backend, file, args }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) return text(`File not found: ${filePath}`);
      try {
        const result = await session.backend.compile(backend, filePath, args);
        return text([
          "## Compile", "",
          `Backend: ${backend}`,
          `File: ${relative(repoRoot, filePath)}`,
          `Status: ${result.success ? "OK" : "FAILED"}`, "",
          result.output || "(no output)",
        ].join("\n"));
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_backend_top",
    "Send a backend-specific top-level payload via Cmd_backend_top.",
    {
      backend: z.string().describe(backendExpressionHelp()),
      payload: z.string().describe("Arbitrary backend payload string"),
    },
    async ({ backend, payload }) => {
      try {
        const result = await session.backend.top(backend, payload);
        return text([
          "## Backend top-level command", "",
          `Backend: ${backend}`,
          `Status: ${result.success ? "OK" : "FAILED"}`, "",
          result.output || "(no output)",
        ].join("\n"));
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_backend_hole",
    "Send a backend-specific hole payload via Cmd_backend_hole.",
    {
      goalId: z.number().describe("Goal ID for the hole command context"),
      holeContents: z.string().optional().describe("Current hole contents text (defaults to empty string)"),
      backend: z.string().describe(backendExpressionHelp()),
      payload: z.string().describe("Arbitrary backend payload string"),
    },
    wrapGoalHandler(session, async ({ goalId, holeContents, backend, payload }) => {
      const result = await session.backend.hole(
        goalId,
        (holeContents as string) ?? "",
        backend as string,
        payload as string,
      );
      return [
        "## Backend hole command", "",
        `Goal: ?${goalId}`,
        `Backend: ${backend}`,
        `Status: ${result.success ? "OK" : "FAILED"}`, "",
        result.output || "(no output)",
      ].join("\n");
    }),
  );
}
