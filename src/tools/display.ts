// MIT License — see LICENSE
//
// Display and highlighting tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession } from "../agda-process.js";
import {
  missingPathToolError,
  registerGoalTextTool,
  registerTextTool,
} from "./tool-helpers.js";
import { resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_load_highlighting_info",
    description: "Load highlighting information for a file using Agda's Cmd_load_highlighting_info.",
    category: "highlighting",
    protocolCommands: ["Cmd_load_highlighting_info"],
    inputSchema: { file: z.string().describe("Path to the .agda file (relative to repo root or absolute)") },
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const result = await session.display.loadHighlightingInfo(filePath);
      return `## Highlighting info loaded\n\nFile: ${relative(repoRoot, requestedFilePath)}\n\n${result.output}\n`;
    },
  });

  registerTextTool({
    server,
    name: "agda_token_highlighting",
    description: "Load token-based highlighting for a file using Agda's Cmd_tokenHighlighting.",
    category: "highlighting",
    protocolCommands: ["Cmd_tokenHighlighting"],
    inputSchema: {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const result = await session.display.tokenHighlighting(filePath);
      return `## Token highlighting\n\nFile: ${relative(repoRoot, requestedFilePath)}\n\n${result.output}\n`;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_highlight",
    description: "Highlight an expression in a goal context using Agda's Cmd_highlight command.",
    category: "highlighting",
    protocolCommands: ["Cmd_highlight"],
    inputSchema: {
      goalId: z.number().describe("Goal ID used as highlighting context"),
      expr: z.string().describe("Expression to highlight"),
    },
    callback: async ({ goalId, expr }) => {
      const result = await session.display.highlight(goalId, expr as string);
      return `## Highlight\n\nGoal: ?${goalId}\nExpression: \`${expr}\`\n\n${result.output}\n`;
    },
  });

  registerTextTool({
    server,
    name: "agda_show_implicit_args",
    description: "Set whether Agda should display implicit arguments.",
    category: "process",
    protocolCommands: ["ShowImplicitArgs"],
    inputSchema: { enabled: z.boolean().describe("True to show implicit arguments, false to hide them") },
    callback: async ({ enabled }: { enabled: boolean }) => {
      const result = await session.display.showImplicitArgs(enabled);
      return `## Show implicit arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
    },
  });

  registerTextTool({
    server,
    name: "agda_toggle_implicit_args",
    description: "Toggle whether Agda displays implicit arguments.",
    category: "process",
    protocolCommands: ["ToggleImplicitArgs"],
    inputSchema: {},
    callback: async () => {
      const result = await session.display.toggleImplicitArgs();
      return `## Toggle implicit arguments\n\n${result.output}\n`;
    },
  });

  registerTextTool({
    server,
    name: "agda_show_irrelevant_args",
    description: "Set whether Agda should display irrelevant arguments.",
    category: "process",
    protocolCommands: ["ShowIrrelevantArgs"],
    inputSchema: { enabled: z.boolean().describe("True to show irrelevant arguments, false to hide them") },
    callback: async ({ enabled }: { enabled: boolean }) => {
      const result = await session.display.showIrrelevantArgs(enabled);
      return `## Show irrelevant arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
    },
  });

  registerTextTool({
    server,
    name: "agda_toggle_irrelevant_args",
    description: "Toggle whether Agda displays irrelevant arguments.",
    category: "process",
    protocolCommands: ["ToggleIrrelevantArgs"],
    inputSchema: {},
    callback: async () => {
      const result = await session.display.toggleIrrelevantArgs();
      return `## Toggle irrelevant arguments\n\n${result.output}\n`;
    },
  });
}
