// MIT License — see LICENSE
//
// Query tools: metas, constraints, solve, auto-all

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { registerGoalTextTool, registerTextTool } from "./tool-helpers.js";
import { applyBatchEditAndReload } from "../session/reload-and-diagnose.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_metas",
    description: "List all unsolved metavariables (goals) in the currently loaded file.",
    category: "proof",
    protocolCommands: ["Cmd_metas"],
    inputSchema: {},
    callback: async () => {
      const result = await session.goal.metas();
      let output = `## Unsolved goals (${result.goals.length})\n\n`;
      if (result.text) output += `\`\`\`\n${result.text}\n\`\`\`\n`;
      if (result.goals.length > 0) {
        output += `\nGoal IDs: ${result.goals.map((g) => `?${g.goalId}`).join(", ")}\n`;
      }
      return output;
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
    inputSchema: {
      writeToFile: z.boolean().optional().describe("Write solutions to the source file and reload (default: true)"),
    },
    callback: async ({ writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.query.solveAll();
      let output = `## Solve all\n\n`;

      if (result.solutions.length === 0) {
        output += `No goals with unique solutions found.\n`;
        return output;
      }

      output += `**Solutions:**\n`;
      for (const s of result.solutions) output += `- ${s}\n`;

      if (shouldWrite && session.currentFile && result.rawSolutions.length > 0) {
        output += await applyBatchEditAndReload(
          session, goalIdsBefore, session.currentFile, result.rawSolutions,
        );
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
    inputSchema: {
      goalId: z.number().describe("The goal ID to solve if it has a unique solution"),
      writeToFile: z.boolean().optional().describe("Write the solution to the source file and reload (default: true)"),
    },
    callback: async ({ goalId, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.query.solveOne(goalId);
      let output = `## Solve one ?${goalId}\n\n`;

      if (result.solutions.length === 0) {
        output += "No unique solution found for that goal.\n";
        return output;
      }

      for (const solution of result.solutions) output += `- ${solution}\n`;

      if (shouldWrite && session.currentFile && result.rawSolutions.length > 0) {
        output += await applyBatchEditAndReload(
          session, goalIdsBefore, session.currentFile, result.rawSolutions,
        );
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
