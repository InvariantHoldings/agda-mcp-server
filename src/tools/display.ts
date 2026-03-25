// MIT License — see LICENSE
//
// Display and highlighting tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession } from "../agda-process.js";
import { wrapHandler, wrapGoalHandler, text } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "agda_load_highlighting_info",
    "Load highlighting information for a file using Agda's Cmd_load_highlighting_info.",
    { file: z.string().describe("Path to the .agda file (relative to repo root or absolute)") },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) return text(`File not found: ${filePath}`);
      try {
        const result = await session.display.loadHighlightingInfo(filePath);
        return text(`## Highlighting info loaded\n\nFile: ${relative(repoRoot, filePath)}\n\n${result.output}\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_token_highlighting",
    "Enable or remove token highlighting for a file using Agda's Cmd_tokenHighlighting.",
    {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
      remove: z.boolean().optional().describe("When true, remove token highlighting for this file"),
    },
    async ({ file, remove }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) return text(`File not found: ${filePath}`);
      try {
        const result = await session.display.tokenHighlighting(filePath, Boolean(remove));
        return text(`## Token highlighting\n\nFile: ${relative(repoRoot, filePath)}\n\n${result.output}\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_highlight",
    "Highlight an expression in a goal context using Agda's Cmd_highlight command.",
    {
      goalId: z.number().describe("Goal ID used as highlighting context"),
      expr: z.string().describe("Expression to highlight"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.display.highlight(goalId, expr as string);
      return `## Highlight\n\nGoal: ?${goalId}\nExpression: \`${expr}\`\n\n${result.output}\n`;
    }),
  );

  server.tool(
    "agda_show_implicit_args",
    "Set whether Agda should display implicit arguments.",
    { enabled: z.boolean().describe("True to show implicit arguments, false to hide them") },
    async ({ enabled }) => {
      try {
        const result = await session.display.showImplicitArgs(enabled);
        return text(`## Show implicit arguments\n\nRequested: ${enabled}\n\n${result.output}\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_toggle_implicit_args",
    "Toggle whether Agda displays implicit arguments.",
    {},
    wrapHandler(session, async () => {
      const result = await session.display.toggleImplicitArgs();
      return `## Toggle implicit arguments\n\n${result.output}\n`;
    }),
  );

  server.tool(
    "agda_show_irrelevant_args",
    "Set whether Agda should display irrelevant arguments.",
    { enabled: z.boolean().describe("True to show irrelevant arguments, false to hide them") },
    async ({ enabled }) => {
      try {
        const result = await session.display.showIrrelevantArgs(enabled);
        return text(`## Show irrelevant arguments\n\nRequested: ${enabled}\n\n${result.output}\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_toggle_irrelevant_args",
    "Toggle whether Agda displays irrelevant arguments.",
    {},
    wrapHandler(session, async () => {
      const result = await session.display.toggleIrrelevantArgs();
      return `## Toggle irrelevant arguments\n\n${result.output}\n`;
    }),
  );
}
