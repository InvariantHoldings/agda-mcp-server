// MIT License — see LICENSE
//
// Session management tools: agda_load, agda_session_status, agda_typecheck

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { AgdaSession, typeCheckBatch } from "../agda-process.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  // ── agda_load ─────────────────────────────────────────────────────
  server.tool(
    "agda_load",
    "Load and type-check an Agda file. This establishes the interactive session — subsequent commands (goal_type, case_split, give, refine, auto) operate on the loaded file's goals. Returns errors, warnings, and a list of unsolved goals with their IDs.",
    {
      file: z.string().describe(
        "Path to the .agda file (relative to repo root or absolute)",
      ),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      try {
        const result = await session.load(filePath);
        const relPath = relative(repoRoot, filePath);

        let output = `## Loaded: ${relPath}\n\n`;
        output += `**Status:** ${result.success ? "OK" : "FAILED"}\n`;
        output += `**Goals:** ${result.goals.length} unsolved\n\n`;

        if (result.errors.length > 0) {
          output += `### Errors\n`;
          for (const err of result.errors) {
            output += `\`\`\`\n${err}\n\`\`\`\n`;
          }
        }

        if (result.allGoalsText) {
          output += `### Goals & Warnings\n\`\`\`\n${result.allGoalsText}\n\`\`\`\n`;
        }

        if (result.goals.length > 0) {
          output += `\n### Goal IDs\n`;
          output += `Use these IDs with \`agda_goal_type\`, \`agda_case_split\`, \`agda_give\`, \`agda_refine\`, \`agda_auto\`, \`agda_compute\`, \`agda_infer\`.\n\n`;
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

  // ── agda_session_status ───────────────────────────────────────────
  server.tool(
    "agda_session_status",
    "Show the current Agda session status: loaded file and available goal IDs.",
    {},
    async () => {
      const loadedFile = session.getLoadedFile();
      const goalIds = session.getGoalIds();

      let output = `## Agda Session Status\n\n`;
      output += `**Loaded file:** ${loadedFile ? relative(repoRoot, loadedFile) : "(none)"}\n`;
      output += `**Goal IDs:** ${goalIds.length > 0 ? goalIds.map((id) => `?${id}`).join(", ") : "(none)"}\n\n`;

      if (!loadedFile) {
        output += `Use \`agda_load\` to load a file and start an interactive session.\n`;
      } else {
        output += `### Available commands\n`;
        output += `- \`agda_goal_type\` — show type/context for a goal\n`;
        output += `- \`agda_case_split\` — case-split on a variable\n`;
        output += `- \`agda_give\` — fill a goal with an expression\n`;
        output += `- \`agda_refine\` — refine a goal\n`;
        output += `- \`agda_auto\` — auto-solve a goal\n`;
        output += `- \`agda_auto_all\` — auto-solve all goals\n`;
        output += `- \`agda_solve_all\` — solve all uniquely-solvable goals\n`;
        output += `- \`agda_compute\` — normalize an expression\n`;
        output += `- \`agda_infer\` — infer the type of an expression\n`;
        output += `- \`agda_elaborate\` — elaborate an expression\n`;
        output += `- \`agda_constraints\` — show constraints\n`;
        output += `- \`agda_why_in_scope\` — explain why a name is in scope\n`;
        output += `- \`agda_show_module\` — show module contents\n`;
        output += `- \`agda_search_about\` — search definitions by type signature\n`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // ── agda_typecheck ────────────────────────────────────────────────
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
