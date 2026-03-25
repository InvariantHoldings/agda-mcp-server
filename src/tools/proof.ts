// MIT License — see LICENSE
//
// Proof interaction tools: goal types, case split, give, refine, auto,
// compute, infer, constraints, elaborate, helper function

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { wrapHandler, wrapGoalHandler, validateGoalId, stalenessWarning, text } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  // ── agda_goal_type ────────────────────────────────────────────────
  server.tool(
    "agda_goal_type",
    "Show the type and local context for a specific goal. Requires a file to be loaded first via agda_load.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.goalTypeContext(goalId);
      let output = `## Goal ?${goalId}\n\n`;
      if (info.context.length > 0) {
        output += `### Context\n\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
      return output;
    }),
  );

  // ── agda_goal ─────────────────────────────────────────────────────
  server.tool(
    "agda_goal",
    "Show only the current goal type for a specific goal, using Agda's exact Cmd_goal_type query.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.goalType(goalId);
      return `## Goal ?${goalId}\n\n### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;
    }),
  );

  // ── agda_context ──────────────────────────────────────────────────
  server.tool(
    "agda_context",
    "Show only the local context for a specific goal, using Agda's exact Cmd_context query.",
    { goalId: z.number().describe("The goal ID (from agda_load output)") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const info = await session.context(goalId);
      let output = `## Context for ?${goalId}\n\n`;
      output += info.context.length > 0
        ? `\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n`
        : "(empty context)\n";
      return output;
    }),
  );

  // ── agda_metas ────────────────────────────────────────────────────
  server.tool(
    "agda_metas",
    "List all unsolved metavariables (goals) in the currently loaded file.",
    {},
    wrapHandler(session, async () => {
      const result = await session.metas();
      let output = `## Unsolved goals (${result.goals.length})\n\n`;
      if (result.text) output += `\`\`\`\n${result.text}\n\`\`\`\n`;
      if (result.goals.length > 0) {
        output += `\nGoal IDs: ${result.goals.map((g) => `?${g.goalId}`).join(", ")}\n`;
      }
      return output;
    }),
  );

  // ── agda_case_split ───────────────────────────────────────────────
  server.tool(
    "agda_case_split",
    "Case-split on a variable in a goal. Returns the new function clauses that replace the current clause. The file must be reloaded after applying the split.",
    {
      goalId: z.number().describe("The goal ID to case-split in"),
      variable: z.string().describe("The variable name to case-split on"),
    },
    wrapGoalHandler(session, async ({ goalId, variable }) => {
      const result = await session.caseSplit(goalId, variable as string);
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

  // ── agda_give ─────────────────────────────────────────────────────
  server.tool(
    "agda_give",
    "Fill a goal with an expression. If the expression type-checks against the goal type, the goal is solved.",
    {
      goalId: z.number().describe("The goal ID to fill"),
      expr: z.string().describe("The Agda expression to give"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.give(goalId, expr as string);
      let output = `## Give \`${expr}\` to ?${goalId}\n\n`;
      output += result.result ? `**Result:** \`${result.result}\`\n` : `Expression accepted.\n`;
      return output;
    }),
  );

  // ── agda_refine ───────────────────────────────────────────────────
  server.tool(
    "agda_refine",
    "Refine a goal by applying a function. Creates new subgoals for the function's arguments.",
    {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with (can be empty to let Agda choose)"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.refine(goalId, expr as string);
      let output = `## Refine ?${goalId} with \`${expr || "(auto)"}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : `Refinement applied. Call \`agda_metas\` to see new goals.\n`;
      return output;
    }),
  );

  // ── agda_refine_exact ────────────────────────────────────────────
  server.tool(
    "agda_refine_exact",
    "Refine a goal using Agda's exact Cmd_refine command.",
    {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.refineExact(goalId, expr as string);
      let output = `## Exact refine ?${goalId} with \`${expr}\`\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Refinement applied. Call `agda_metas` to inspect resulting goals.\n";
      return output;
    }),
  );

  // ── agda_intro ───────────────────────────────────────────────────
  server.tool(
    "agda_intro",
    "Introduce a lambda or constructor using Agda's exact Cmd_intro command.",
    {
      goalId: z.number().describe("The goal ID to introduce into"),
      expr: z.string().optional().describe("Optional existing goal contents to use as input"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.intro(goalId, (expr as string) ?? "");
      let output = `## Intro ?${goalId}\n\n`;
      output += result.result
        ? `**Result:** \`${result.result}\`\n`
        : "Introduction applied. Call `agda_metas` to inspect resulting goals.\n";
      return output;
    }),
  );

  // ── agda_auto ─────────────────────────────────────────────────────
  server.tool(
    "agda_auto",
    "Attempt to automatically solve a goal using Agda's proof search.",
    { goalId: z.number().describe("The goal ID to auto-solve") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const result = await session.autoOne(goalId);
      let output = `## Auto-solve ?${goalId}\n\n`;
      output += result.solution ? `**Solution:** \`${result.solution}\`\n` : `No automatic solution found.\n`;
      return output;
    }),
  );

  // ── agda_auto_all ─────────────────────────────────────────────────
  server.tool(
    "agda_auto_all",
    "Attempt to automatically solve all goals using Agda's proof search.",
    {},
    wrapHandler(session, async () => {
      const result = await session.autoAll();
      let output = `## Auto-solve all goals\n\n`;
      output += result.solution
        ? `**Result:**\n\`\`\`\n${result.solution}\n\`\`\`\n`
        : `No automatic solutions found.\n`;
      return output;
    }),
  );

  // ── agda_solve_all ────────────────────────────────────────────────
  server.tool(
    "agda_solve_all",
    "Attempt to solve all goals that have unique solutions.",
    {},
    wrapHandler(session, async () => {
      const result = await session.solveAll();
      let output = `## Solve all\n\n`;
      if (result.solutions.length > 0) {
        for (const s of result.solutions) output += `- ${s}\n`;
      } else {
        output += `No goals with unique solutions found.\n`;
      }
      return output;
    }),
  );

  // ── agda_solve_one ───────────────────────────────────────────────
  server.tool(
    "agda_solve_one",
    "Attempt to solve one goal that has a unique solution using Agda's exact Cmd_solveOne command.",
    { goalId: z.number().describe("The goal ID to solve if it has a unique solution") },
    wrapGoalHandler(session, async ({ goalId }) => {
      const result = await session.solveOne(goalId);
      let output = `## Solve one ?${goalId}\n\n`;
      if (result.solutions.length > 0) {
        for (const solution of result.solutions) output += `- ${solution}\n`;
      } else {
        output += "No unique solution found for that goal.\n";
      }
      return output;
    }),
  );

  // ── agda_compute ──────────────────────────────────────────────────
  server.tool(
    "agda_compute",
    "Normalize (evaluate) an expression. If goalId is provided, evaluates in that goal's context; otherwise evaluates at the top level.",
    {
      expr: z.string().describe("The Agda expression to normalize"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ expr, goalId }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId);
        if (invalid) return invalid;
      }
      try {
        const warn = stalenessWarning(session);
        const result = goalId !== undefined
          ? await session.compute(goalId, expr)
          : await session.computeTopLevel(expr);
        return text(warn + `## Normalize \`${expr}\`\n\n\`\`\`agda\n${result.normalForm || "(no result)"}\n\`\`\`\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── agda_infer ────────────────────────────────────────────────────
  server.tool(
    "agda_infer",
    "Infer the type of an expression. If goalId is provided, infers in that goal's context; otherwise infers at the top level.",
    {
      expr: z.string().describe("The Agda expression to infer the type of"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ expr, goalId }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId);
        if (invalid) return invalid;
      }
      try {
        const warn = stalenessWarning(session);
        const result = goalId !== undefined
          ? await session.infer(goalId, expr)
          : await session.inferTopLevel(expr);
        return text(warn + `## Type of \`${expr}\`\n\n\`\`\`agda\n${result.type || "(unable to infer)"}\n\`\`\`\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── agda_constraints ──────────────────────────────────────────────
  server.tool(
    "agda_constraints",
    "Show the current constraint set for the loaded file.",
    {},
    wrapHandler(session, async () => {
      const result = await session.constraints();
      let output = `## Constraints\n\n`;
      output += result.text ? `\`\`\`\n${result.text}\n\`\`\`\n` : `No constraints.\n`;
      return output;
    }),
  );

  // ── agda_elaborate ────────────────────────────────────────────────
  server.tool(
    "agda_elaborate",
    "Elaborate an expression in a goal context: normalize and show the fully explicit form.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to elaborate"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.elaborate(goalId, expr as string);
      return `## Elaborate \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.elaboration || "(no result)"}\n\`\`\`\n`;
    }),
  );

  // ── agda_goal_type_context_check ─────────────────────────────────
  server.tool(
    "agda_goal_type_context_check",
    "Show the goal context, goal type, and checked elaborated term for an expression in a goal context.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to check against the goal type"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goalTypeContextCheck(goalId, expr as string);
      let output = `## Goal ?${goalId}, context, and checked term\n\n`;
      if (result.context.length > 0) {
        output += `### Context\n\n\`\`\`agda\n${result.context.join("\n")}\n\`\`\`\n\n`;
      }
      output += `### Goal type\n\n\`\`\`agda\n${result.goalType || "(unknown)"}\n\`\`\`\n\n`;
      output += `### Checked term for \`${expr}\`\n\n\`\`\`agda\n${result.checkedExpr || "(no checked term returned)"}\n\`\`\`\n`;
      return output;
    }),
  );

  // ── agda_helper_function ──────────────────────────────────────────
  server.tool(
    "agda_helper_function",
    "Generate a helper function type signature for an expression in a goal context. Useful for extracting a subproof into a named lemma.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The expression to generate a helper for"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.helperFunction(goalId, expr as string);
      return `## Helper function for \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.helperType || "(no result)"}\n\`\`\`\n`;
    }),
  );

  // ── agda_goal_type_context_infer ─────────────────────────────────
  server.tool(
    "agda_goal_type_context_infer",
    "Show the goal context, goal type, and inferred type of an expression in a goal context.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to infer in context"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.goalTypeContextInfer(goalId, expr as string);
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
