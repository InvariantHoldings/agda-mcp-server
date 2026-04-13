// MIT License — see LICENSE
//
// Goal interaction tools: type, context, case split, give, refine, intro, auto

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { registerGoalTextTool } from "./tool-helpers.js";
import { applyProofEdit, type ProofEdit, type ApplyEditResult } from "../session/apply-proof-edit.js";
import type { LoadResult } from "../agda/types.js";

/**
 * Apply a proof edit to the file, reload, and return output describing
 * what happened. Handles both success and failure:
 * - On success: writes the edit, reloads, surfaces any reload errors/warnings.
 * - On edit failure: reloads the unchanged file to resync the Agda session
 *   (which has already mutated its internal state).
 */
async function applyEditAndReload(
  session: AgdaSession,
  goalIdsBefore: number[],
  edit: ProofEdit,
): Promise<string> {
  const filePath = session.currentFile;
  if (!filePath) return "";

  const editResult: ApplyEditResult = await applyProofEdit(filePath, goalIdsBefore, edit);

  if (editResult.applied) {
    const loadResult: LoadResult = await session.load(filePath);
    let output = `\n${editResult.message}\n`;
    if (loadResult.success) {
      output += `Reloaded: ${loadResult.goalCount} goal(s) remaining.\n`;
    } else {
      output += `Reloaded with errors: ${loadResult.goalCount} goal(s) remaining.\n`;
      if (loadResult.errors.length > 0) {
        output += `**Errors:** ${loadResult.errors.join("; ")}\n`;
      }
    }
    if (loadResult.warnings.length > 0) {
      output += `**Warnings:** ${loadResult.warnings.join("; ")}\n`;
    }
    return output;
  }

  // Edit failed — session state is out of sync with the file on disk.
  // Reload the unchanged file to resync.
  let output = `\n**Warning:** ${editResult.message}\n`;
  try {
    const loadResult = await session.load(filePath);
    output += `Reloaded unchanged file to resync session: ${loadResult.goalCount} goal(s).\n`;
    output += `Apply the edit manually, then call \`agda_load\` to reload.\n`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output += `**Warning:** Failed to resync session after edit failure (${msg}). Run \`agda_load\` manually.\n`;
  }
  return output;
}

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerGoalTextTool({
    server,
    session,
    name: "agda_goal_type",
    description: "Show the type and local context for a specific goal. Requires a file to be loaded first via agda_load.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type_context"],
    inputSchema: { goalId: z.number().describe("The goal ID (from agda_load output)") },
    callback: async ({ goalId }) => {
      const info = await session.goal.typeContext(goalId);
      let output = `## Goal ?${goalId}\n\n`;
      if (info.context.length > 0) {
        output += `### Context\n\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_goal",
    description: "Show only the current goal type for a specific goal, using Agda's exact Cmd_goal_type query.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type"],
    inputSchema: { goalId: z.number().describe("The goal ID (from agda_load output)") },
    callback: async ({ goalId }) => {
      const info = await session.goal.type(goalId);
      return `## Goal ?${goalId}\n\n### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_context",
    description: "Show only the local context for a specific goal, using Agda's exact Cmd_context query.",
    category: "proof",
    protocolCommands: ["Cmd_context"],
    inputSchema: { goalId: z.number().describe("The goal ID (from agda_load output)") },
    callback: async ({ goalId }) => {
      const info = await session.goal.context(goalId);
      let output = `## Context for ?${goalId}\n\n`;
      output += info.context.length > 0
        ? `\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n`
        : "(empty context)\n";
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_case_split",
    description: "Case-split on a variable in a goal. Returns the new function clauses that replace the current clause. By default, writes changes to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_make_case"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to case-split in"),
      variable: z.string().describe("The variable name to case-split on"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, variable, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.caseSplit(goalId, variable as string);
      let output = `## Case split on \`${variable}\` in ?${goalId}\n\n`;
      if (result.clauses.length > 0) {
        output += `### New clauses\n\`\`\`agda\n${result.clauses.join("\n")}\n\`\`\`\n`;

        if (shouldWrite && session.currentFile) {
          output += await applyEditAndReload(session, goalIdsBefore, {
            kind: "replace-line", goalId, clauses: result.clauses,
          });
        } else {
          output += `\nReplace the original clause with these, then call \`agda_load\` to reload.\n`;
        }
      } else {
        output += `No clauses generated. The variable may not be splittable.\n`;
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_give",
    description: "Fill a goal with an expression. If the expression type-checks against the goal type, the goal is solved. By default, writes the change to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_give"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to fill"),
      expr: z.string().describe("The Agda expression to give"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, expr, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const exprStr = expr as string;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.give(goalId, exprStr);
      let output = `## Give \`${exprStr}\` to ?${goalId}\n\n`;
      output += result.result ? `**Result:** \`${result.result}\`\n` : `Expression accepted.\n`;

      if (shouldWrite && session.currentFile) {
        output += await applyEditAndReload(session, goalIdsBefore, {
          kind: "replace-hole", goalId, expr: result.replacementText ?? exprStr,
        });
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_refine",
    description: "Refine a goal by applying a function. Creates new subgoals for the function's arguments. By default, writes changes to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_refine_or_intro"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with (can be empty to let Agda choose)"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, expr, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const exprStr = expr as string;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.refine(goalId, exprStr);
      let output = `## Refine ?${goalId} with \`${exprStr || "(auto)"}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : `Refinement applied. Call \`agda_metas\` to see new goals.\n`;

      if (shouldWrite && session.currentFile) {
        output += await applyEditAndReload(session, goalIdsBefore, {
          kind: "replace-hole", goalId, expr: result.replacementText ?? exprStr,
        });
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_refine_exact",
    description: "Refine a goal using Agda's exact Cmd_refine command. By default, writes changes to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_refine"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, expr, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const exprStr = expr as string;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.refineExact(goalId, exprStr);
      let output = `## Exact refine ?${goalId} with \`${exprStr}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Refinement applied. Call `agda_metas` to inspect resulting goals.\n";

      if (shouldWrite && session.currentFile) {
        output += await applyEditAndReload(session, goalIdsBefore, {
          kind: "replace-hole", goalId, expr: result.replacementText ?? exprStr,
        });
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_intro",
    description: "Introduce a lambda or constructor using Agda's exact Cmd_intro command. By default, writes changes to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_intro"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to introduce into"),
      expr: z.string().optional().describe("Optional existing goal contents to use as input"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, expr, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const exprStr = (expr as string | undefined) ?? "";
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.intro(goalId, exprStr);
      let output = `## Intro ?${goalId}\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Introduction applied. Call `agda_metas` to inspect resulting goals.\n";

      if (shouldWrite && session.currentFile) {
        const replacementExpr = result.replacementText ?? (exprStr || null);
        if (replacementExpr != null) {
          output += await applyEditAndReload(session, goalIdsBefore, {
            kind: "replace-hole", goalId, expr: replacementExpr,
          });
        }
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_auto",
    description: "Attempt to automatically solve a goal using Agda's proof search. By default, writes the solution to the file and reloads.",
    category: "proof",
    protocolCommands: ["Cmd_autoOne"],
    inputSchema: {
      goalId: z.number().describe("The goal ID to auto-solve"),
      writeToFile: z.boolean().optional().describe("Write changes to the file and reload (default: true)"),
    },
    callback: async ({ goalId, writeToFile }) => {
      const shouldWrite = writeToFile !== false;
      const goalIdsBefore = session.getGoalIds();
      const result = await session.goal.autoOne(goalId);
      let output = `## Auto-solve ?${goalId}\n\n`;
      output += result.solution ? `**Solution:** \`${result.solution}\`\n` : `No automatic solution found.\n`;

      if (shouldWrite && session.currentFile && result.solution) {
        output += await applyEditAndReload(session, goalIdsBefore, {
          kind: "replace-hole", goalId, expr: result.solution,
        });
      }
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_goal_type_context_check",
    description: "Show the goal context, goal type, and checked elaborated term for an expression in a goal context.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type_context_check"],
    inputSchema: {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to check against the goal type"),
    },
    callback: async ({ goalId, expr }) => {
      const result = await session.goal.typeContextCheck(goalId, expr as string);
      let output = `## Goal ?${goalId}, context, and checked term\n\n`;
      if (result.context.length > 0) {
        output += `### Context\n\n\`\`\`agda\n${result.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\n\`\`\`agda\n${result.goalType || "(unknown)"}\n\`\`\`\n\n`;
      output += `### Checked term for \`${expr}\`\n\n\`\`\`agda\n${result.checkedExpr || "(no checked term returned)"}\n\`\`\`\n`;
      return output;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_goal_type_context_infer",
    description: "Show the goal context, goal type, and inferred type of an expression in a goal context.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type_context_infer"],
    inputSchema: {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to infer in context"),
    },
    callback: async ({ goalId, expr }) => {
      const result = await session.query.goalTypeContextInfer(goalId, expr as string);
      let output = `## Goal ?${goalId}, context, and inferred type\n\n`;
      if (result.context.length > 0) {
        output += `### Context\n\n\`\`\`agda\n${result.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\n\`\`\`agda\n${result.goalType || "(unknown)"}\n\`\`\`\n\n`;
      output += `### Inferred type for \`${expr}\`\n\n\`\`\`agda\n${result.inferredType || "(unable to infer)"}\n\`\`\`\n`;
      return output;
    },
  });
}
