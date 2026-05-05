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
import { goalIdSchema } from "./tool-schemas.js";

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
  /**
   * Defaults to `true`. See `ToolManifestEntry.requiresLoadedSession`
   * for semantics. Pass `false` for tools that must run in a
   * no-file state (load-establishers, session introspection).
   */
  requiresLoadedSession?: boolean;
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
    requiresLoadedSession: args.requiresLoadedSession,
  });

  // Wrap the callback to automatically measure wall-clock time AND
  // catch any uncaught exception from the body. Without the catch,
  // a stray `readFileSync` or `JSON.parse` on user-controlled input
  // throws straight up to the MCP framework and the caller sees an
  // unstructured RPC error instead of a `ToolResult`. With the catch,
  // every tool call returns a structured envelope — `ok=false` plus
  // a tool-error diagnostic with a `nextAction` recovery hint —
  // even when the callback forgets its own try/catch.
  // If the callback already sets elapsedMs on the envelope, that value
  // is preserved. Otherwise elapsedMs is filled in automatically.
  const timedCallback = async (toolArgs: any) => {
    const startMs = performance.now();
    let result: unknown;
    try {
      result = await args.callback(toolArgs);
    } catch (err) {
      result = makeTextToolErrorResult(args.name, err, {});
    }
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
  /**
   * Defaults to `true`. See `ToolManifestEntry.requiresLoadedSession`.
   */
  requiresLoadedSession?: boolean;
  /**
   * Either return a text body (legacy path) or a structured payload
   * with the same text rendering plus extra fields. Tools that have
   * machine-decoded data — solve solutions, display state, postulate
   * lists — should return the structured form so the envelope's
   * `data` carries the parsed result alongside the prose body.
   * Issue #11 scope: "expand richer per-tool data beyond plain text
   * where still missing".
   */
  callback: (cbArgs: any) => Promise<string | { text: string; data?: Record<string, unknown> }>;
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
    requiresLoadedSession: args.requiresLoadedSession,
    callback: async (cbArgs: any) => {
      const startMs = performance.now();
      if (args.session) {
        const unavailable = sessionErrorStateGate(args.session, args.name, { text: "" });
        if (unavailable) return unavailable;
      }
      try {
        const raw = await args.callback(cbArgs);
        const { text: textValue, extra } = unpackTextCallbackResult(raw);
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            // `summary` is contractually a 1-line digest, but text-only
            // tools historically produced multi-line bodies and had it
            // duplicated whole. Take the first non-empty line; the full
            // body still goes in `data.text` and the markdown body
            // alongside.
            summary: digestText(textValue),
            data: { text: textValue, ...extra },
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
 * Reserved envelope-data keys the wrapper controls. A tool callback
 * cannot override them via its `data` payload — letting it would let
 * `data.text` desync from the markdown body, or let `data.goalId`
 * disagree with the validated `cbArgs.goalId`.
 */
const RESERVED_TEXT_DATA_KEYS = new Set(["text"]);
const RESERVED_GOAL_TEXT_DATA_KEYS = new Set(["text", "goalId"]);

/**
 * Normalize a `registerTextTool` / `registerGoalTextTool` callback
 * return value to the `{ text, extra }` shape the envelope builder
 * expects. Accepts the legacy bare-string form for backward compat.
 *
 * `reserved` names any keys the wrapper itself owns (`text`, plus
 * `goalId` for goal tools); they are stripped from `extra` so a
 * callback's `data` payload cannot clobber them on merge.
 */
function unpackTextCallbackResult(
  raw: string | { text: string; data?: Record<string, unknown> },
  reserved: Set<string> = RESERVED_TEXT_DATA_KEYS,
): { text: string; extra: Record<string, unknown> } {
  if (typeof raw === "string") {
    return { text: raw, extra: {} };
  }
  const data = raw.data ?? {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (reserved.has(key)) continue;
    extra[key] = value;
  }
  return { text: raw.text, extra };
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
  callback: (cbArgs: A & { goalId: number }) => Promise<string | { text: string; data?: Record<string, unknown> }>;
}): void {
  const outputDataSchema =
    args.outputDataSchema
    ?? z.object({ text: z.string(), goalId: goalIdSchema });

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
        const raw = await args.callback(cbArgs);
        const { text: body, extra } = unpackTextCallbackResult(
          raw,
          RESERVED_GOAL_TEXT_DATA_KEYS,
        );
        const textValue = warn + body;
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            // 1-line digest of the goal-text body (multi-line bodies
            // would otherwise be repeated whole in `summary`).
            summary: digestText(body),
            data: { text: body, goalId: cbArgs.goalId, ...extra },
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
