// MIT License — see LICENSE
//
// Display and highlighting tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession } from "../agda-process.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "agda_load_highlighting_info",
    "Load highlighting information for a file using Agda's Cmd_load_highlighting_info.",
    {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        const result = await session.loadHighlightingInfo(filePath);
        const output = `## Highlighting info loaded\n\nFile: ${relative(repoRoot, filePath)}\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
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
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        const result = await session.tokenHighlighting(filePath, Boolean(remove));
        const output = `## Token highlighting\n\nFile: ${relative(repoRoot, filePath)}\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
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
    async ({ goalId, expr }) => {
      try {
        const result = await session.highlight(goalId, expr);
        const output = `## Highlight\n\nGoal: ?${goalId}\nExpression: \`${expr}\`\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_show_implicit_args",
    "Set whether Agda should display implicit arguments.",
    {
      enabled: z.boolean().describe("True to show implicit arguments, false to hide them"),
    },
    async ({ enabled }) => {
      try {
        const result = await session.showImplicitArgs(enabled);
        const output = `## Show implicit arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_toggle_implicit_args",
    "Toggle whether Agda displays implicit arguments.",
    {},
    async () => {
      try {
        const result = await session.toggleImplicitArgs();
        const output = `## Toggle implicit arguments\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_show_irrelevant_args",
    "Set whether Agda should display irrelevant arguments.",
    {
      enabled: z.boolean().describe("True to show irrelevant arguments, false to hide them"),
    },
    async ({ enabled }) => {
      try {
        const result = await session.showIrrelevantArgs(enabled);
        const output = `## Show irrelevant arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_toggle_irrelevant_args",
    "Toggle whether Agda displays irrelevant arguments.",
    {},
    async () => {
      try {
        const result = await session.toggleIrrelevantArgs();
        const output = `## Toggle irrelevant arguments\n\n${result.output}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );
}
