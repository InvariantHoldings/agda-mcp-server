// MIT License — see LICENSE
//
// Tool-registration wrappers: register*Tool helpers and wrap*Handler
// composables. Each register* function installs a tool on the MCP
// server, pushes a manifest entry, and wraps the user callback with
// automatic wall-clock timing, goal/session gating, and error-to-
// envelope translation. The register wrappers delegate to the same
// underlying ToolEnvelope constructors and ToolResult shape exported
// from tool-envelope.ts, so every tool handler in the server follows
// the same contract.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { AgdaSession } from "../agda-process.js";
import type { ToolCategory } from "./manifest.js";
import { registerManifestEntry } from "./manifest.js";

import {
  makeToolResult,
  okEnvelope,
  toolEnvelopeSchema,
  type ToolEnvelope,
  type ToolResult,
} from "./tool-envelope.js";
import { makeTextToolErrorResult } from "./tool-errors.js";
import {
  sessionErrorStateGate,
  stalenessWarning,
  validateGoalId,
} from "./tool-gates.js";

/**
 * Wrap a session tool handler with staleness warning and error handling.
 * The handler returns a complete structured envelope.
 * Automatically measures wall-clock time and sets elapsedMs on the envelope
 * if the handler did not already set it.
 */
export function wrapStructuredHandler<T extends Record<string, unknown>>(
  tool: string,
  session: AgdaSession,
  handler: () => Promise<{ envelope: ToolEnvelope<T>; text?: string }>,
): () => Promise<ToolResult<Record<string, unknown>>> {
  return async () => {
    const startMs = performance.now();
    try {
      const result = await handler();
      if (result.envelope.elapsedMs === undefined) {
        result.envelope.elapsedMs = Math.round(performance.now() - startMs);
      }
      return makeToolResult(result.envelope, result.text);
    } catch (err) {
      return makeTextToolErrorResult(tool, err, {});
    }
  };
}

/**
 * Backward-compatible wrapper for existing text-only handlers.
 * New code should prefer wrapStructuredHandler.
 */
export function wrapHandler(
  session: AgdaSession,
  handler: () => Promise<string>,
): () => Promise<ToolResult<Record<string, unknown>>> {
  return wrapStructuredHandler("text-tool", session, async () => {
    const warn = stalenessWarning(session);
    const body = await handler();
    const textValue = warn + body;
    return {
      envelope: okEnvelope({
        tool: "text-tool",
        summary: body,
        data: { text: body },
        stale: session.isFileStale() || undefined,
      }),
      text: textValue,
    };
  });
}

/**
 * Wrap a goal-based tool handler with validation, staleness warning,
 * and error handling. The handler returns a complete structured envelope.
 * Automatically measures wall-clock time and sets elapsedMs on the envelope
 * if the handler did not already set it.
 */
export function wrapStructuredGoalHandler<A extends Record<string, unknown>, T extends Record<string, unknown>>(
  tool: string,
  session: AgdaSession,
  handler: (args: A & { goalId: number }) => Promise<{ envelope: ToolEnvelope<T>; text?: string }>,
): (args: A & { goalId: number }) => Promise<ToolResult<Record<string, unknown>>> {
  return async (args) => {
    const startMs = performance.now();
    const invalid = validateGoalId(session, args.goalId, tool);
    if (invalid) return invalid;
    try {
      const result = await handler(args);
      result.envelope.elapsedMs ??= Math.round(performance.now() - startMs);
      return makeToolResult(result.envelope, result.text);
    } catch (err) {
      return makeTextToolErrorResult(tool, err, { text: "", goalId: args.goalId });
    }
  };
}

/**
 * Backward-compatible wrapper for existing text-only goal handlers.
 * New code should prefer wrapStructuredGoalHandler.
 */
export function wrapGoalHandler<A extends Record<string, unknown>>(
  session: AgdaSession,
  handler: (args: A & { goalId: number }) => Promise<string>,
): (args: A & { goalId: number }) => Promise<ToolResult<Record<string, unknown>>> {
  return wrapStructuredGoalHandler("goal-tool", session, async (args) => {
    const warn = stalenessWarning(session);
    const body = await handler(args);
    const textValue = warn + body;
    return {
      envelope: okEnvelope({
        tool: "goal-tool",
        summary: body,
        data: { text: body, goalId: args.goalId },
        stale: session.isFileStale() || undefined,
      }),
      text: textValue,
    };
  });
}

export function registerStructuredTool(args: {
  server: McpServer;
  name: string;
  description: string;
  category: ToolCategory;
  protocolCommands?: string[];
  inputSchema?: unknown;
  outputDataSchema: z.ZodTypeAny;
  annotations?: ToolAnnotations;
  callback: (cbArgs: any) => unknown;
}): void {
  registerManifestEntry({
    name: args.name,
    description: args.description,
    category: args.category,
    protocolCommands: args.protocolCommands,
    inputSchema: args.inputSchema,
    outputDataSchema: args.outputDataSchema,
    annotations: args.annotations,
  });

  // Wrap the callback to automatically measure wall-clock time.
  // If the callback already sets elapsedMs on the envelope, that value
  // is preserved. Otherwise elapsedMs is filled in automatically.
  const timedCallback = async (toolArgs: any) => {
    const startMs = performance.now();
    const result = await args.callback(toolArgs);
    const elapsed = Math.round(performance.now() - startMs);
    if (
      result &&
      typeof result === "object" &&
      "structuredContent" in result
    ) {
      const structuredContent = (result as any).structuredContent;
      if (structuredContent && typeof structuredContent === "object" && structuredContent.elapsedMs === undefined) {
        structuredContent.elapsedMs = elapsed;
      }
    }
    return result;
  };

  args.server.registerTool(
    args.name,
    {
      description: args.description,
      inputSchema: args.inputSchema as never,
      outputSchema: toolEnvelopeSchema(args.outputDataSchema),
      annotations: args.annotations,
    },
    timedCallback as never,
  );
}

export function registerTextTool(args: {
  server: McpServer;
  name: string;
  description: string;
  category: ToolCategory;
  protocolCommands?: string[];
  inputSchema?: unknown;
  annotations?: ToolAnnotations;
  outputDataSchema?: z.ZodTypeAny;
  /**
   * Optional session reference. When provided, the wrapper short-
   * circuits the tool with an `unavailable` envelope if the session's
   * most recent load classification is `type-error` — see §1.3 in the
   * agent UX observations doc. Callers that are informational in
   * nature (status tools, load-family, tools that MUST run in error
   * state to surface the errors themselves) should omit the session
   * argument so the wrapper doesn't gate them. If omitted, the
   * behavior is unchanged from the pre-#39 release.
   */
  session?: AgdaSession;
  callback: (cbArgs: any) => Promise<string>;
}): void {
  const outputDataSchema =
    args.outputDataSchema ?? z.object({ text: z.string() });

  registerStructuredTool({
    server: args.server,
    name: args.name,
    description: args.description,
    category: args.category,
    protocolCommands: args.protocolCommands,
    inputSchema: args.inputSchema,
    annotations: args.annotations,
    outputDataSchema,
    callback: async (cbArgs: any) => {
      const startMs = performance.now();
      if (args.session) {
        const unavailable = sessionErrorStateGate(args.session, args.name, { text: "" });
        if (unavailable) return unavailable;
      }
      try {
        const textValue = await args.callback(cbArgs);
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            // `summary` is contractually a 1-line digest, but text-only
            // tools historically produced multi-line bodies and had it
            // duplicated whole. Take the first non-empty line; the full
            // body still goes in `data.text` and the markdown body
            // alongside.
            summary: digestText(textValue),
            data: { text: textValue },
            elapsedMs: Math.round(performance.now() - startMs),
          }),
          textValue,
        );
      } catch (err) {
        return makeTextToolErrorResult(args.name, err, { text: "" });
      }
    },
  });
}

/**
 * Take the first non-empty line of `text` as a 1-line summary digest,
 * truncating overly long lines. Used by text-only tool wrappers so the
 * envelope's `summary` field stays terse even when the body is a
 * multi-line markdown blob.
 */
function digestText(text: string): string {
  const firstNonEmpty = text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? text.trim();
  if (firstNonEmpty.length <= 200) return firstNonEmpty;
  return firstNonEmpty.slice(0, 197) + "…";
}

export function registerGoalTextTool<A extends Record<string, unknown>>(args: {
  server: McpServer;
  session: AgdaSession;
  name: string;
  description: string;
  category: ToolCategory;
  protocolCommands?: string[];
  inputSchema: unknown;
  annotations?: ToolAnnotations;
  outputDataSchema?: z.ZodTypeAny;
  callback: (cbArgs: A & { goalId: number }) => Promise<string>;
}): void {
  const outputDataSchema =
    args.outputDataSchema
    ?? z.object({ text: z.string(), goalId: z.number() });

  registerStructuredTool({
    server: args.server,
    name: args.name,
    description: args.description,
    category: args.category,
    protocolCommands: args.protocolCommands,
    inputSchema: args.inputSchema,
    annotations: args.annotations,
    outputDataSchema,
    callback: async (cbArgs: A & { goalId: number }) => {
      const startMs = performance.now();
      const invalid = validateGoalId(args.session, cbArgs.goalId, args.name);
      if (invalid) {
        return invalid;
      }

      // §1.3: gate goal-based tools when the session's last load
      // failed with type-error. Even with a valid goalId that was
      // captured during the previous successful load, the session
      // can no longer answer goal queries coherently and Agda will
      // echo the stale error — surface it as `unavailable` instead.
      const unavailable = sessionErrorStateGate(
        args.session,
        args.name,
        { text: "", goalId: cbArgs.goalId },
      );
      if (unavailable) return unavailable;

      try {
        const warn = stalenessWarning(args.session);
        const body = await args.callback(cbArgs);
        const textValue = warn + body;
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            // 1-line digest of the goal-text body (multi-line bodies
            // would otherwise be repeated whole in `summary`).
            summary: digestText(body),
            data: { text: body, goalId: cbArgs.goalId },
            stale: args.session.isFileStale() || undefined,
            elapsedMs: Math.round(performance.now() - startMs),
          }),
          textValue,
        );
      } catch (err) {
        return makeTextToolErrorResult(args.name, err, {
          text: "",
          goalId: cbArgs.goalId,
        });
      }
    },
  });
}
