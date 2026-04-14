// MIT License — see LICENSE
//
// Backend command tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession, filePathDescription } from "../agda-process.js";
import {
  missingPathToolError,
  registerGoalTextTool,
  registerTextTool,
} from "./tool-helpers.js";
import { resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";

function backendExpressionHelp(): string {
  return "Backend constructor expression (for example: GHC, GHCNoMain, LaTeX, QuickLaTeX, or OtherBackend \"JS\").";
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_compile",
    description: "Compile a module through Agda's Cmd_compile command using a selected backend.",
    category: "backend",
    protocolCommands: ["Cmd_compile"],
    inputSchema: {
      backend: z.string().describe(backendExpressionHelp()),
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      args: z.array(z.string()).optional().describe("Optional Agda CLI arguments for the compile command"),
    },
    callback: async ({ backend, file, args }: { backend: string; file: string; args?: string[] }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const result = await session.backend.compile(backend, filePath, args);
      return [
        "## Compile", "",
        `Backend: ${backend}`,
        `File: ${relative(repoRoot, requestedFilePath)}`,
        `Status: ${result.success ? "OK" : "FAILED"}`, "",
        result.output || "(no output)",
      ].join("\n");
    },
  });

  registerTextTool({
    server,
    name: "agda_backend_top",
    description: "Send a backend-specific top-level payload via Cmd_backend_top.",
    category: "backend",
    protocolCommands: ["Cmd_backend_top"],
    inputSchema: {
      backend: z.string().describe(backendExpressionHelp()),
      payload: z.string().describe("Arbitrary backend payload string"),
    },
    callback: async ({ backend, payload }: { backend: string; payload: string }) => {
      const result = await session.backend.top(backend, payload);
      return [
        "## Backend top-level command", "",
        `Backend: ${backend}`,
        `Status: ${result.success ? "OK" : "FAILED"}`, "",
        result.output || "(no output)",
      ].join("\n");
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_backend_hole",
    description: "Send a backend-specific hole payload via Cmd_backend_hole.",
    category: "backend",
    protocolCommands: ["Cmd_backend_hole"],
    inputSchema: {
      goalId: z.number().describe("Goal ID for the hole command context"),
      holeContents: z.string().optional().describe("Current hole contents text (defaults to empty string)"),
      backend: z.string().describe(backendExpressionHelp()),
      payload: z.string().describe("Arbitrary backend payload string"),
    },
    callback: async ({ goalId, holeContents, backend, payload }) => {
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
    },
  });
}
