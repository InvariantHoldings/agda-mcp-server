// MIT License — see LICENSE
//
// Session management tools: agda_load, agda_session_status, agda_typecheck

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession, typeCheckBatch } from "../agda-process.js";
import { stalenessWarning } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "agda_load",
    "Load and type-check an Agda file. This establishes the interactive session — subsequent commands operate on the loaded file's goals.",
    {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        // Detect reload scenario for user feedback
        const prevFile = session.getLoadedFile();
        const isReload = prevFile === filePath;
        const wasStale = isReload && session.isFileStale();

        const result = await session.load(filePath);
        const relPath = relative(repoRoot, filePath);

        let output = "";
        if (isReload && wasStale) {
          output += "**Reloading modified file.**\n\n";
        } else if (isReload) {
          output += "**Re-type-checking (file unchanged).**\n\n";
        }
        output += `## Loaded: ${relPath}\n\n`;
        output += `**Status:** ${result.success ? "OK" : "FAILED"}\n`;
        output += `**Goals:** ${result.goals.length} unsolved\n`;
        if (result.invisibleGoalCount > 0) {
          output += `**Invisible goals (abstract):** ${result.invisibleGoalCount}\n`;
        }
        output += "\n";

        if (result.errors.length > 0) {
          output += "### Errors\n";
          for (const err of result.errors) {
            output += `\`\`\`\n${err}\n\`\`\`\n`;
          }
        }

        if (result.allGoalsText) {
          output += `### Goals & Warnings\n\`\`\`\n${result.allGoalsText}\n\`\`\`\n`;
        }

        if (result.goals.length > 0) {
          output += "\n### Goal IDs\n";
          output += "Use these IDs with `agda_goal_type`, `agda_case_split`, `agda_give`, `agda_refine`, `agda_auto`, `agda_compute`, `agda_infer`.\n\n";
          for (const goal of result.goals) {
            output += `- **?${goal.goalId}**\n`;
          }
        }

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Agda load failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_load_no_metas",
    "Load and type-check an Agda file, failing if unsolved metavariables remain after loading.",
    {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        const result = await session.loadNoMetas(filePath);
        const relPath = relative(repoRoot, filePath);

        let output = `## Loaded without metas: ${relPath}\n\n`;
        output += `**Status:** ${result.success ? "OK" : "FAILED"}\n`;
        output += `**Goals:** ${result.goals.length} unsolved\n\n`;

        if (result.errors.length > 0) {
          output += "### Errors\n";
          for (const err of result.errors) {
            output += `\`\`\`\n${err}\n\`\`\`\n`;
          }
        }

        if (result.success && result.goals.length === 0) {
          output += "No unsolved goals remain.\n";
        }

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Agda strict load failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_session_status",
    "Show the current Agda session status: phase, loaded file, and available goal IDs.",
    {},
    async () => {
      const warn = stalenessWarning(session);
      const loadedFile = session.getLoadedFile();
      const goalIds = session.getGoalIds();
      const phase = session.getPhase();

      let output = warn + "## Agda Session Status\n\n";
      output += `**Phase:** ${phase}\n`;
      output += `**Loaded file:** ${loadedFile ? relative(repoRoot, loadedFile) : "(none)"}\n`;
      output += `**Goal IDs:** ${goalIds.length > 0 ? goalIds.map((id) => `?${id}`).join(", ") : "(none)"}\n\n`;

      if (!loadedFile) {
        output += "Use `agda_load` to load a file and start an interactive session.\n";
      } else {
        output += "### Available commands\n";
        output += "- `agda_goal_type` — show type/context for a goal\n";
        output += "- `agda_goal` — show only the goal type\n";
        output += "- `agda_context` — show only the local context\n";
        output += "- `agda_case_split` — case-split on a variable\n";
        output += "- `agda_give` — fill a goal with an expression\n";
        output += "- `agda_refine` — refine a goal\n";
        output += "- `agda_refine_exact` — exact Cmd_refine\n";
        output += "- `agda_intro` — exact Cmd_intro\n";
        output += "- `agda_auto` — auto-solve a goal\n";
        output += "- `agda_auto_all` — auto-solve all goals\n";
        output += "- `agda_solve_all` — solve all uniquely-solvable goals\n";
        output += "- `agda_solve_one` — solve one uniquely-solvable goal\n";
        output += "- `agda_compute` — normalize an expression\n";
        output += "- `agda_infer` — infer the type of an expression\n";
        output += "- `agda_elaborate` — elaborate an expression\n";
        output += "- `agda_goal_type_context_check` — show goal, context, and checked term\n";
        output += "- `agda_constraints` — show constraints\n";
        output += "- `agda_goal_type_context_infer` — show goal, context, and inferred type\n";
        output += "- `agda_show_version` — show the running Agda version\n";
        output += "- `agda_abort` — send Cmd_abort\n";
        output += "- `agda_exit` — send Cmd_exit\n";
        output += "- `agda_load_highlighting_info` — load highlighting data for a file\n";
        output += "- `agda_token_highlighting` — keep/remove token highlighting for a file\n";
        output += "- `agda_highlight` — highlight an expression in a goal context\n";
        output += "- `agda_show_implicit_args` / `agda_toggle_implicit_args` — control implicit-argument display\n";
        output += "- `agda_show_irrelevant_args` / `agda_toggle_irrelevant_args` — control irrelevant-argument display\n";
        output += "- `agda_compile` — run Cmd_compile with a selected backend\n";
        output += "- `agda_backend_top` — send backend payload at top level\n";
        output += "- `agda_backend_hole` — send backend payload for a goal hole\n";
        output += "- `agda_why_in_scope` — explain why a name is in scope\n";
        output += "- `agda_show_module` — show module contents\n";
        output += "- `agda_search_about` — search definitions by type signature\n";
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  server.tool(
    "agda_show_version",
    "Show the version string reported by the running Agda interactive process.",
    {},
    async () => {
      try {
        const result = await session.showVersion();
        const output = `## Agda version\n\n${result.version || "(version unavailable)"}\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_abort",
    "Send Cmd_abort to the running Agda process.",
    {},
    async () => {
      try {
        await session.abort();
        return { content: [{ type: "text" as const, text: "Abort command sent to Agda.\n" }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Abort failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_exit",
    "Send Cmd_exit to the running Agda process and let the session shut down cleanly.",
    {},
    async () => {
      try {
        await session.exit();
        return { content: [{ type: "text" as const, text: "Exit command sent to Agda.\n" }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Exit failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    "agda_typecheck",
    "Quick batch type-check of an Agda file (stateless — does not establish an interactive session). Use agda_load for interactive proof work.",
    {
      file: z.string().describe("Path to the .agda file"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        const result = await typeCheckBatch(filePath, repoRoot);
        const relPath = relative(repoRoot, filePath);

        let output = `## Type-check: ${relPath}\n\n`;
        output += `**Status:** ${result.success ? "OK" : "FAILED"}\n\n`;

        if (result.errors.length > 0) {
          output += `### Errors (${result.errors.length})\n`;
          for (const err of result.errors) output += `- ${err}\n`;
        }
        if (result.warnings.length > 0) {
          output += `### Warnings (${result.warnings.length})\n`;
          for (const warn of result.warnings) output += `- ${warn}\n`;
        }

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Agda invocation failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );
}
