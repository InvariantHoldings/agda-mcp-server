// MIT License — see LICENSE
//
// Proof interaction tools: goal types, case split, give, refine, auto,
// compute, infer, constraints, elaborate, helper function

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  // ── agda_goal_type ────────────────────────────────────────────────
  server.tool(
    "agda_goal_type",
    "Show the type and local context for a specific goal. Requires a file to be loaded first via agda_load.",
    {
      goalId: z.number().describe("The goal ID (from agda_load output)"),
    },
    async ({ goalId }) => {
      try {
        const info = await session.goalTypeContext(goalId);
        let output = `## Goal ?${goalId}\n\n`;

        if (info.context.length > 0) {
          output += `### Context\n\`\`\`agda\n${info.context.join("\n")}\n\`\`\`\n\n`;
        }
        output += `### Goal type\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n`;

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_metas ────────────────────────────────────────────────────
  server.tool(
    "agda_metas",
    "List all unsolved metavariables (goals) in the currently loaded file.",
    {},
    async () => {
      try {
        const result = await session.metas();
        let output = `## Unsolved goals (${result.goals.length})\n\n`;
        if (result.text) {
          output += `\`\`\`\n${result.text}\n\`\`\`\n`;
        }
        if (result.goals.length > 0) {
          output += `\nGoal IDs: ${result.goals.map((g) => `?${g.goalId}`).join(", ")}\n`;
        }
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_case_split ───────────────────────────────────────────────
  server.tool(
    "agda_case_split",
    "Case-split on a variable in a goal. Returns the new function clauses that replace the current clause. The file must be reloaded after applying the split.",
    {
      goalId: z.number().describe("The goal ID to case-split in"),
      variable: z.string().describe("The variable name to case-split on"),
    },
    async ({ goalId, variable }) => {
      try {
        const result = await session.caseSplit(goalId, variable);
        let output = `## Case split on \`${variable}\` in ?${goalId}\n\n`;

        if (result.clauses.length > 0) {
          output += `### New clauses\n\`\`\`agda\n${result.clauses.join("\n")}\n\`\`\`\n`;
          output += `\nReplace the original clause with these, then call \`agda_load\` to reload.\n`;
        } else {
          output += `No clauses generated. The variable may not be splittable.\n`;
        }

        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_give ─────────────────────────────────────────────────────
  server.tool(
    "agda_give",
    "Fill a goal with an expression. If the expression type-checks against the goal type, the goal is solved.",
    {
      goalId: z.number().describe("The goal ID to fill"),
      expr: z.string().describe("The Agda expression to give"),
    },
    async ({ goalId, expr }) => {
      try {
        const result = await session.give(goalId, expr);
        let output = `## Give \`${expr}\` to ?${goalId}\n\n`;
        output += result.result
          ? `**Result:** \`${result.result}\`\n`
          : `Expression accepted.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_refine ───────────────────────────────────────────────────
  server.tool(
    "agda_refine",
    "Refine a goal by applying a function. Creates new subgoals for the function's arguments.",
    {
      goalId: z.number().describe("The goal ID to refine"),
      expr: z.string().describe("The expression to refine with (can be empty to let Agda choose)"),
    },
    async ({ goalId, expr }) => {
      try {
        const result = await session.refine(goalId, expr);
        let output = `## Refine ?${goalId} with \`${expr || "(auto)"}\`\n\n`;
        output += result.result
          ? `**Result:** \`${result.result}\`\n`
          : `Refinement applied. Call \`agda_metas\` to see new goals.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_auto ─────────────────────────────────────────────────────
  server.tool(
    "agda_auto",
    "Attempt to automatically solve a goal using Agda's proof search.",
    {
      goalId: z.number().describe("The goal ID to auto-solve"),
    },
    async ({ goalId }) => {
      try {
        const result = await session.autoOne(goalId);
        let output = `## Auto-solve ?${goalId}\n\n`;
        output += result.solution
          ? `**Solution:** \`${result.solution}\`\n`
          : `No automatic solution found.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_auto_all ─────────────────────────────────────────────────
  server.tool(
    "agda_auto_all",
    "Attempt to automatically solve all goals using Agda's proof search.",
    {},
    async () => {
      try {
        const result = await session.autoAll();
        let output = `## Auto-solve all goals\n\n`;
        output += result.solution
          ? `**Result:**\n\`\`\`\n${result.solution}\n\`\`\`\n`
          : `No automatic solutions found.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_solve_all ────────────────────────────────────────────────
  server.tool(
    "agda_solve_all",
    "Attempt to solve all goals that have unique solutions.",
    {},
    async () => {
      try {
        const result = await session.solveAll();
        let output = `## Solve all\n\n`;
        if (result.solutions.length > 0) {
          for (const s of result.solutions) {
            output += `- ${s}\n`;
          }
        } else {
          output += `No goals with unique solutions found.\n`;
        }
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
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
      try {
        const result = goalId !== undefined
          ? await session.compute(goalId, expr)
          : await session.computeTopLevel(expr);
        let output = `## Normalize \`${expr}\`\n\n`;
        output += `\`\`\`agda\n${result.normalForm || "(no result)"}\n\`\`\`\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
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
      try {
        const result = goalId !== undefined
          ? await session.infer(goalId, expr)
          : await session.inferTopLevel(expr);
        let output = `## Type of \`${expr}\`\n\n`;
        output += `\`\`\`agda\n${result.type || "(unable to infer)"}\n\`\`\`\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_constraints ──────────────────────────────────────────────
  server.tool(
    "agda_constraints",
    "Show the current constraint set for the loaded file.",
    {},
    async () => {
      try {
        const result = await session.constraints();
        let output = `## Constraints\n\n`;
        output += result.text
          ? `\`\`\`\n${result.text}\n\`\`\`\n`
          : `No constraints.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_elaborate ────────────────────────────────────────────────
  server.tool(
    "agda_elaborate",
    "Elaborate an expression in a goal context: normalize and show the fully explicit form.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to elaborate"),
    },
    async ({ goalId, expr }) => {
      try {
        const result = await session.elaborate(goalId, expr);
        let output = `## Elaborate \`${expr}\` in ?${goalId}\n\n`;
        output += `\`\`\`agda\n${result.elaboration || "(no result)"}\n\`\`\`\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_helper_function ──────────────────────────────────────────
  server.tool(
    "agda_helper_function",
    "Generate a helper function type signature for an expression in a goal context. Useful for extracting a subproof into a named lemma.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The expression to generate a helper for"),
    },
    async ({ goalId, expr }) => {
      try {
        const result = await session.helperFunction(goalId, expr);
        let output = `## Helper function for \`${expr}\` in ?${goalId}\n\n`;
        output += `\`\`\`agda\n${result.helperType || "(no result)"}\n\`\`\`\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );
}
