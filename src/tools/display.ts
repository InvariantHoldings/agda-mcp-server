// MIT License — see LICENSE
//
// Display and highlighting tools.

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
import { goalIdSchema } from "./tool-schemas.js";

/**
 * Schema for the decoded display-state snapshot Agda returns on its
 * status events. `null` distinguishes "Agda did not report this flag"
 * from a known true/false. Reused by every display-control tool.
 */
const displayStateSchema = z.object({
  showImplicitArguments: z.boolean().nullable(),
  showIrrelevantArguments: z.boolean().nullable(),
  checked: z.boolean().nullable(),
});

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
    inputSchema: { file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)) },
    outputDataSchema: z.object({
      text: z.string(),
      file: z.string(),
      state: displayStateSchema,
    }),
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const result = await session.display.loadHighlightingInfo(filePath);
      const text = `## Highlighting info loaded\n\nFile: ${relative(repoRoot, requestedFilePath)}\n\n${result.output}\n`;
      return {
        text,
        data: {
          file: relative(repoRoot, requestedFilePath),
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });

  registerTextTool({
    server,
    name: "agda_token_highlighting",
    description: "Load token-based highlighting for a file using Agda's Cmd_tokenHighlighting.",
    category: "highlighting",
    protocolCommands: ["Cmd_tokenHighlighting"],
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
    },
    outputDataSchema: z.object({
      text: z.string(),
      file: z.string(),
      state: displayStateSchema,
    }),
    callback: async ({ file }: { file: string }) => {
      const requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      if (!existsSync(requestedFilePath)) {
        throw missingPathToolError("file", requestedFilePath);
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const result = await session.display.tokenHighlighting(filePath);
      const text = `## Token highlighting\n\nFile: ${relative(repoRoot, requestedFilePath)}\n\n${result.output}\n`;
      return {
        text,
        data: {
          file: relative(repoRoot, requestedFilePath),
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
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
      goalId: goalIdSchema.describe("Goal ID used as highlighting context"),
      expr: z.string().describe("Expression to highlight"),
    },
    outputDataSchema: z.object({
      text: z.string(),
      goalId: goalIdSchema,
      expr: z.string(),
      state: displayStateSchema,
    }),
    callback: async ({ goalId, expr }) => {
      const result = await session.display.highlight(goalId, expr as string);
      const text = `## Highlight\n\nGoal: ?${goalId}\nExpression: \`${expr}\`\n\n${result.output}\n`;
      return {
        text,
        data: {
          expr: expr as string,
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });

  registerTextTool({
    server,
    name: "agda_show_implicit_args",
    description: "Set whether Agda should display implicit arguments.",
    category: "process",
    protocolCommands: ["ShowImplicitArgs"],
    inputSchema: { enabled: z.boolean().describe("True to show implicit arguments, false to hide them") },
    outputDataSchema: z.object({
      text: z.string(),
      requested: z.boolean(),
      state: displayStateSchema,
    }),
    callback: async ({ enabled }: { enabled: boolean }) => {
      const result = await session.display.showImplicitArgs(enabled);
      const text = `## Show implicit arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
      return {
        text,
        data: {
          requested: enabled,
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });

  registerTextTool({
    server,
    name: "agda_toggle_implicit_args",
    description: "Toggle whether Agda displays implicit arguments.",
    category: "process",
    protocolCommands: ["ToggleImplicitArgs"],
    inputSchema: {},
    outputDataSchema: z.object({
      text: z.string(),
      state: displayStateSchema,
    }),
    callback: async () => {
      const result = await session.display.toggleImplicitArgs();
      const text = `## Toggle implicit arguments\n\n${result.output}\n`;
      return {
        text,
        data: {
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });

  registerTextTool({
    server,
    name: "agda_show_irrelevant_args",
    description: "Set whether Agda should display irrelevant arguments.",
    category: "process",
    protocolCommands: ["ShowIrrelevantArgs"],
    inputSchema: { enabled: z.boolean().describe("True to show irrelevant arguments, false to hide them") },
    outputDataSchema: z.object({
      text: z.string(),
      requested: z.boolean(),
      state: displayStateSchema,
    }),
    callback: async ({ enabled }: { enabled: boolean }) => {
      const result = await session.display.showIrrelevantArgs(enabled);
      const text = `## Show irrelevant arguments\n\nRequested: ${enabled}\n\n${result.output}\n`;
      return {
        text,
        data: {
          requested: enabled,
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });

  registerTextTool({
    server,
    name: "agda_toggle_irrelevant_args",
    description: "Toggle whether Agda displays irrelevant arguments.",
    category: "process",
    protocolCommands: ["ToggleIrrelevantArgs"],
    inputSchema: {},
    outputDataSchema: z.object({
      text: z.string(),
      state: displayStateSchema,
    }),
    callback: async () => {
      const result = await session.display.toggleIrrelevantArgs();
      const text = `## Toggle irrelevant arguments\n\n${result.output}\n`;
      return {
        text,
        data: {
          state: {
            showImplicitArguments: result.showImplicitArguments,
            showIrrelevantArguments: result.showIrrelevantArguments,
            checked: result.checked,
          },
        },
      };
    },
  });
}
