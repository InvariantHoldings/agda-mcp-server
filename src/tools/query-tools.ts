// MIT License — see LICENSE
//
// Query tools: metas, constraints, solve, auto-all

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { relative } from "node:path";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import {
  errorEnvelope,
  groupDiagnosticsByFile,
  infoDiagnostic,
  makeToolResult,
  okEnvelope,
  registerGoalTextTool,
  registerStructuredTool,
  registerTextTool,
  warningDiagnostic,
} from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_metas",
    description: "List all unsolved metavariables (goals) in the currently loaded file, tagged by owning file so diagnostics from the loaded file can be distinguished from diagnostics from dependencies.",
    category: "proof",
    protocolCommands: ["Cmd_metas"],
    inputSchema: {},
    outputDataSchema: z.object({
      loadedFile: z.string().nullable(),
      goalCount: z.number(),
      goalIds: z.array(z.number()),
      text: z.string(),
      errorsByFile: z.array(
        z.object({
          file: z.string().nullable(),
          ownedByLoadedFile: z.boolean(),
          messages: z.array(z.string()),
        }),
      ),
      warningsByFile: z.array(
        z.object({
          file: z.string().nullable(),
          ownedByLoadedFile: z.boolean(),
          messages: z.array(z.string()),
        }),
      ),
    }),
    callback: async () => {
      try {
        const result = await session.goal.metas();
        const absLoadedFile = session.getLoadedFile?.() ?? null;
        const loadedFileRel = absLoadedFile ? relative(repoRoot, absLoadedFile) : null;

        // §1.2: group diagnostics by their owning file and tag each
        // group with whether it matches the currently loaded file.
        // "ownedByLoadedFile=false" entries are diagnostics from
        // dependencies — agents should treat those as blocking
        // before attempting further queries on the loaded file.
        const rawErrors = groupDiagnosticsByFile(result.errors ?? []);
        const rawWarnings = groupDiagnosticsByFile(result.warnings ?? []);

        const tagOwnership = (
          group: { file: string | null; messages: string[] },
        ): { file: string | null; ownedByLoadedFile: boolean; messages: string[] } => {
          if (group.file === null) {
            return { ...group, ownedByLoadedFile: false };
          }
          // Compare against both the relative and absolute loaded
          // file path so agents get the same answer whether the
          // diagnostic embedded an absolute path or a workspace-
          // relative path.
          const matchesAbs = absLoadedFile !== null && group.file === absLoadedFile;
          const matchesRel = loadedFileRel !== null
            && (group.file === loadedFileRel || group.file.endsWith(`/${loadedFileRel}`));
          return { ...group, ownedByLoadedFile: matchesAbs || matchesRel };
        };

        const errorsByFile = rawErrors.map(tagOwnership);
        const warningsByFile = rawWarnings.map(tagOwnership);

        const depErrorCount = errorsByFile
          .filter((group) => !group.ownedByLoadedFile && group.file !== null)
          .reduce((sum, group) => sum + group.messages.length, 0);

        const diagnostics = [];
        if (depErrorCount > 0) {
          diagnostics.push(
            warningDiagnostic(
              `${depErrorCount} error(s) reported from files other than the loaded file — likely broken dependencies. Fix those before re-running query tools.`,
              "dependency-errors",
            ),
          );
        }
        if (result.goals.length > 0) {
          diagnostics.push(
            infoDiagnostic(
              `Found ${result.goals.length} unsolved meta(s).`,
              "metas-found",
            ),
          );
        }

        let output = `## Unsolved goals (${result.goals.length})\n\n`;
        if (loadedFileRel) {
          output += `**Loaded file:** \`${loadedFileRel}\`\n\n`;
        }
        if (result.text) output += `\`\`\`\n${result.text}\n\`\`\`\n`;
        if (result.goals.length > 0) {
          output += `\nGoal IDs: ${result.goals.map((g) => `?${g.goalId}`).join(", ")}\n`;
        }
        if (depErrorCount > 0) {
          output += `\n**⚠ ${depErrorCount} error(s) from dependency files — fix those first.**\n`;
        }

        return makeToolResult(
          okEnvelope({
            tool: "agda_metas",
            summary: `Found ${result.goals.length} unsolved meta(s)${
              depErrorCount > 0 ? ` (plus ${depErrorCount} dependency error(s))` : ""
            }.`,
            data: {
              loadedFile: loadedFileRel,
              goalCount: result.goals.length,
              goalIds: result.goals.map((g) => g.goalId),
              text: result.text,
              errorsByFile,
              warningsByFile,
            },
            diagnostics,
            stale: session.isFileStale() || undefined,
            provenance: { loadedFile: absLoadedFile, protocolCommands: ["Cmd_metas"] },
          }),
          output,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_metas",
            summary: message,
            data: {
              loadedFile: null,
              goalCount: 0,
              goalIds: [],
              text: "",
              errorsByFile: [],
              warningsByFile: [],
            },
          }),
          message,
        );
      }
    },
  });

  registerTextTool({
    server,
    name: "agda_auto_all",
    description: "Attempt to automatically solve all goals using Agda's proof search.",
    category: "proof",
    protocolCommands: ["Cmd_autoAll"],
    inputSchema: {},
    callback: async () => {
      const result = await session.query.autoAll();
      let output = `## Auto-solve all goals\n\n`;
      output += result.solution
        ? `**Result:**\n\`\`\`\n${result.solution}\n\`\`\`\n`
        : `No automatic solutions found.\n`;
      return output;
    },
  });

  registerTextTool({
    server,
    name: "agda_solve_all",
    description: "Attempt to solve all goals that have unique solutions.",
    category: "proof",
    protocolCommands: ["Cmd_solveAll"],
    inputSchema: {},
    callback: async () => {
      const result = await session.query.solveAll();
      let output = `## Solve all\n\n`;
      if (result.solutions.length > 0) {
        for (const s of result.solutions) output += `- ${s}\n`;
      } else {
        output += `No goals with unique solutions found.\n`;
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_solve_one",
    description: "Attempt to solve one goal that has a unique solution using Agda's exact Cmd_solveOne command.",
    category: "proof",
    protocolCommands: ["Cmd_solveOne"],
    inputSchema: { goalId: z.number().describe("The goal ID to solve if it has a unique solution") },
    callback: async ({ goalId }) => {
      const result = await session.query.solveOne(goalId);
      let output = `## Solve one ?${goalId}\n\n`;
      if (result.solutions.length > 0) {
        for (const solution of result.solutions) output += `- ${solution}\n`;
      } else {
        output += "No unique solution found for that goal.\n";
      }
      return output;
    },
  });

  registerTextTool({
    server,
    name: "agda_constraints",
    description: "Show the current constraint set for the loaded file.",
    category: "proof",
    protocolCommands: ["Cmd_constraints"],
    inputSchema: {},
    callback: async () => {
      const result = await session.query.constraints();
      let output = `## Constraints\n\n`;
      output += result.text ? `\`\`\`\n${result.text}\n\`\`\`\n` : `No constraints.\n`;
      return output;
    },
  });
}
