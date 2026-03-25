// MIT License — see LICENSE
//
// Goal interaction tools: type, context, case split, give, refine, intro, auto

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { wrapGoalHandler } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  server.tool(
    "agda_goal_type",
    "Show the type and local context for a specific goal. Requires a file to be loaded first via agda_load.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.goal.typeContext(goalId);
      let output = `## Goal ?${goalId}\n\n`;
      if (info.context.length > 0) {
        output += `### Context\n\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
      return output;
    }),
  );

  server.tool(
    "agda_goal",
    "Show only the current goal type for a specific goal, using Agda's exact Cmd_goal_type query.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.goal.type(goalId);
      return `## Goal ?${goalId}\n\n### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
    }),
  );

  server.tool(
    "agda_context",
    "Show only the local context for a specific goal, using Agda's exact Cmd_context query.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.goal.context(goalId);
      let output = `## Context for ?${goalId}\n\n`;
      output += info.context.length > 0
        ? `\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n`
        : "(empty context)\n";
      return output;
    }),
  );

  server.tool(
    "agda_case_split",
    "Case-split on a variable in a goal. Returns the new function clauses that replace the current clause. The file must be reloaded after applying the split.",
    {
      goalId: z.number().describe("The goal ID to case-split in"),
      variable: z.string().describe("The variable name to case-split on"),
    },
    wrapGoalHandler(session, async ({ goalId, variable }) => {
      const result = await session.goal.caseSplit(goalId, variable as string);
      let output = `## Case split on \`${variable}\` in ?${goalId}\n\n`;
      if (result.clauses.length > 0) {
        output += `### New clauses\n\`\`\`agda\n${result.clauses.join("\n")}\n\`\`\`\n`;
        output += `\nReplace the original clause with these, then call \`agda_load\` to reload.\n`;
      } else {
        output += `No clauses generated. The variable may not be splittable.\n`;
      }
      return output;
    }),
  );

  server.tool(
    "agda_give",
    "Fill a goal with an expression. If the expression type-checks against the goal type, the goal is solved.",
    {
      goalId: z.number().describe("The goal ID to fill"),
      expr: z.string().describe("The Agda expression to give"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goal.give(goalId, expr as string);
      let output = `## Give \`${expr}\` to ?${goalId}\n\n`;
      output += result.result ? `**Result:** \`${result.result}\`\n` : `Expression accepted.\n`;
      return output;
    }),
  );

  server.tool(
    "agda_refine",
    "Refine a goal by applying a function. Creates new subgoals for the function's arguments.",
    {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with (can be empty to let Agda choose)"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goal.refine(goalId, expr as string);
      let output = `## Refine ?${goalId} with \`${expr || "(auto)"}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : `Refinement applied. Call \`agda_metas\` to see new goals.\n`;
      return output;
    }),
  );

  server.tool(
    "agda_refine_exact",
    "Refine a goal using Agda's exact Cmd_refine command.",
    {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goal.refineExact(goalId, expr as string);
      let output = `## Exact refine ?${goalId} with \`${expr}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Refinement applied. Call `agda_metas` to inspect resulting goals.\n";
      return output;
    }),
  );

  server.tool(
    "agda_intro",
    "Introduce a lambda or constructor using Agda's exact Cmd_intro command.",
    {
      goalId: z.number().describe("The goal ID to introduce into"),
      expr: z.string().optional().describe("Optional existing goal contents to use as input"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goal.intro(goalId, (expr as string) ?? "");
      let output = `## Intro ?${goalId}\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Introduction applied. Call `agda_metas` to inspect resulting goals.\n";
      return output;
    }),
  );

  server.tool(
    "agda_auto",
    "Attempt to automatically solve a goal using Agda's proof search.",
    { goalId: z.number().describe("The goal ID to auto-solve") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const result = await session.goal.autoOne(goalId);
      let output = `## Auto-solve ?${goalId}\n\n`;
      output += result.solution ? `**Solution:** \`${result.solution}\`\n` : `No automatic solution found.\n`;
      return output;
    }),
  );

  server.tool(
    "agda_goal_type_context_check",
    "Show the goal context, goal type, and checked elaborated term for an expression in a goal context.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to check against the goal type"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goal.typeContextCheck(goalId, expr as string);
      let output = `## Goal ?${goalId}, context, and checked term\n\n`;
      if (result.context.length > 0) {
        output += `### Context\n\n\`\`\`agda\n${result.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\n\`\`\`agda\n${result.goalType || "(unknown)"}\n\`\`\`\n\n`;
      output += `### Checked term for \`${expr}\`\n\n\`\`\`agda\n${result.checkedExpr || "(no checked term returned)"}\n\`\`\`\n`;
      return output;
    }),
  );

  server.tool(
    "agda_goal_type_context_infer",
    "Show the goal context, goal type, and inferred type of an expression in a goal context.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to infer in context"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.query.goalTypeContextInfer(goalId, expr as string);
      let output = `## Goal ?${goalId}, context, and inferred type\n\n`;
      if (result.context.length > 0) {
        output += `### Context\n\n\`\`\`agda\n${result.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\n\`\`\`agda\n${result.goalType || "(unknown)"}\n\`\`\`\n\n`;
      output += `### Inferred type for \`${expr}\`\n\n\`\`\`agda\n${result.inferredType || "(unable to infer)"}\n\`\`\`\n`;
      return output;
    }),
  );
}
