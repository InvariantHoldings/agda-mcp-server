// MIT License — see LICENSE
//
// Expression-level tools: compute, infer, elaborate, helper function

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { wrapGoalHandler, validateGoalId, stalenessWarning, text } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
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
          ? await session.expr.compute(goalId, expr)
          : await session.expr.computeTopLevel(expr);
        return text(warn + `## Normalize \`${expr}\`\n\n\`\`\`agda\n${result.normalForm || "(no result)"}\n\`\`\`\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

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
          ? await session.expr.infer(goalId, expr)
          : await session.expr.inferTopLevel(expr);
        return text(warn + `## Type of \`${expr}\`\n\n\`\`\`agda\n${result.type || "(unable to infer)"}\n\`\`\`\n`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_elaborate",
    "Elaborate an expression in a goal context: normalize and show the fully explicit form.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to elaborate"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.query.elaborate(goalId, expr as string);
      return `## Elaborate \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.elaboration || "(no result)"}\n\`\`\`\n`;
    }),
  );

  server.tool(
    "agda_helper_function",
    "Generate a helper function type signature for an expression in a goal context. Useful for extracting a subproof into a named lemma.",
    {
      goalId: z.number().describe("The goal ID for context"),
      expr: z.string().describe("The expression to generate a helper for"),
    },
    wrapGoalHandler(session, async ({ goalId, expr }) => {
      const result = await session.query.helperFunction(goalId, expr as string);
      return `## Helper function for \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.helperType || "(no result)"}\n\`\`\`\n`;
    }),
  );
}
