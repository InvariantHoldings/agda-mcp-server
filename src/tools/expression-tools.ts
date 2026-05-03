// MIT License — see LICENSE
//
// Expression-level tools: compute, infer, elaborate, helper function

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import {
  makeToolResult,
  okEnvelope,
  errorEnvelope,
  errorDiagnostic,
  registerGoalTextTool,
  registerStructuredTool,
  sessionErrorStateGate,
  validateGoalId,
} from "./tool-helpers.js";
import { goalIdSchema, optionalGoalIdSchema } from "./tool-schemas.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_compute",
    description: "Normalize (evaluate) an expression. If goalId is provided, evaluates in that goal's context; otherwise evaluates at the top level.",
    category: "proof",
    protocolCommands: ["Cmd_compute", "Cmd_compute_toplevel"],
    inputSchema: {
      expr: z.string().describe("The Agda expression to normalize"),
      goalId: optionalGoalIdSchema.describe("Optional goal ID for context"),
    },
    outputDataSchema: z.object({
      expr: z.string(),
      goalId: optionalGoalIdSchema,
      normalForm: z.string(),
    }),
    callback: async ({ expr, goalId }: { expr: string; goalId?: number }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId, "agda_compute");
        if (invalid) return invalid;
      }
      const unavailable = sessionErrorStateGate(
        session,
        "agda_compute",
        { expr, goalId, normalForm: "" },
      );
      if (unavailable) return unavailable;
      try {
        const result = goalId !== undefined
          ? await session.expr.compute(goalId, expr)
          : await session.expr.computeTopLevel(expr);
        const textValue = `## Normalize \`${expr}\`\n\n\`\`\`agda\n${result.normalForm || "(no result)"}\n\`\`\`\n`;
        return makeToolResult(
          okEnvelope({
            tool: "agda_compute",
            summary: `Normalized \`${expr}\`.`,
            data: { expr, goalId, normalForm: result.normalForm || "(no result)" },
            stale: session.isFileStale() || undefined,
          }),
          textValue,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_compute",
            summary: message,
            data: { expr, goalId, normalForm: "" },
            diagnostics: [errorDiagnostic(message, "compute-error")],
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_infer",
    description: "Infer the type of an expression. If goalId is provided, infers in that goal's context; otherwise infers at the top level.",
    category: "proof",
    protocolCommands: ["Cmd_infer", "Cmd_infer_toplevel"],
    inputSchema: {
      expr: z.string().describe("The Agda expression to infer the type of"),
      goalId: optionalGoalIdSchema.describe("Optional goal ID for context"),
    },
    outputDataSchema: z.object({
      expr: z.string(),
      goalId: optionalGoalIdSchema,
      inferredType: z.string(),
    }),
    callback: async ({ expr, goalId }: { expr: string; goalId?: number }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId, "agda_infer");
        if (invalid) return invalid;
      }
      const unavailable = sessionErrorStateGate(
        session,
        "agda_infer",
        { expr, goalId, inferredType: "" },
      );
      if (unavailable) return unavailable;
      try {
        const result = goalId !== undefined
          ? await session.expr.infer(goalId, expr)
          : await session.expr.inferTopLevel(expr);
        const textValue = `## Type of \`${expr}\`\n\n\`\`\`agda\n${result.type || "(unable to infer)"}\n\`\`\`\n`;
        return makeToolResult(
          okEnvelope({
            tool: "agda_infer",
            summary: `Inferred the type of \`${expr}\`.`,
            data: { expr, goalId, inferredType: result.type || "(unable to infer)" },
            stale: session.isFileStale() || undefined,
          }),
          textValue,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_infer",
            summary: message,
            data: { expr, goalId, inferredType: "" },
            diagnostics: [errorDiagnostic(message, "infer-error")],
          }),
          message,
        );
      }
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_elaborate",
    description: "Elaborate an expression in a goal context: normalize and show the fully explicit form.",
    category: "proof",
    protocolCommands: ["Cmd_elaborate_give"],
    inputSchema: {
      goalId: goalIdSchema.describe("The goal ID for context"),
      expr: z.string().describe("The Agda expression to elaborate"),
    },
    callback: async ({ goalId, expr }) => {
      const result = await session.query.elaborate(goalId, expr as string);
      return `## Elaborate \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.elaboration || "(no result)"}\n\`\`\`\n`;
    },
  });

  registerGoalTextTool({
    server,
    session,
    name: "agda_helper_function",
    description: "Generate a helper function type signature for an expression in a goal context. Useful for extracting a subproof into a named lemma.",
    category: "proof",
    protocolCommands: ["Cmd_helper_function"],
    inputSchema: {
      goalId: goalIdSchema.describe("The goal ID for context"),
      expr: z.string().describe("The expression to generate a helper for"),
    },
    callback: async ({ goalId, expr }) => {
      const result = await session.query.helperFunction(goalId, expr as string);
      return `## Helper function for \`${expr}\` in ?${goalId}\n\n\`\`\`agda\n${result.helperType || "(no result)"}\n\`\`\`\n`;
    },
  });
}
