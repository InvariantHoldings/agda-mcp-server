// MIT License — see LICENSE
//
// Shared helpers for MCP tool handlers: staleness warnings, goal
// validation, manifest registration, and structured output envelopes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { AgdaSession } from "../agda-process.js";
import { PathSandboxError } from "../repo-root.js";
import type { ToolCategory } from "./manifest.js";
import { registerManifestEntry } from "./manifest.js";

export interface ToolDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

export interface ToolEnvelope<T extends Record<string, unknown>> {
  tool: string;
  ok: boolean;
  classification: string;
  summary: string;
  data: T;
  diagnostics: ToolDiagnostic[];
  stale?: boolean;
  provenance?: Record<string, unknown>;
}

export class ToolInvocationError<T extends Record<string, unknown> = Record<string, unknown>> extends Error {
  classification: string;
  diagnostics: ToolDiagnostic[];
  data: T;
  text?: string;

  constructor(args: {
    message: string;
    classification?: string;
    diagnostics?: ToolDiagnostic[];
    data?: T;
    text?: string;
  }) {
    super(args.message);
    this.name = "ToolInvocationError";
    this.classification = args.classification ?? "tool-error";
    this.diagnostics = args.diagnostics ?? [errorDiagnostic(args.message)];
    this.data = args.data ?? ({} as T);
    this.text = args.text;
  }
}

type ToolResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  content: { type: "text"; text: string }[];
  structuredContent: ToolEnvelope<T>;
  isError?: boolean;
};

export const diagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  code: z.string().optional(),
});

const envelopeBaseSchema = z.object({
  tool: z.string(),
  ok: z.boolean(),
  classification: z.string(),
  summary: z.string(),
  diagnostics: z.array(diagnosticSchema),
  stale: z.boolean().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

export function toolEnvelopeSchema(
  dataSchema: z.ZodTypeAny,
): z.ZodTypeAny {
  return envelopeBaseSchema.extend({
    data: dataSchema,
  });
}

export function makeToolResult<T extends Record<string, unknown>>(
  envelope: ToolEnvelope<T>,
  text?: string,
): ToolResult<T> {
  return {
    content: [{ type: "text" as const, text: text ?? envelope.summary }],
    structuredContent: envelope,
    isError: !envelope.ok,
  };
}

export function infoDiagnostic(message: string, code?: string): ToolDiagnostic {
  return { severity: "info", message, code };
}

export function warningDiagnostic(message: string, code?: string): ToolDiagnostic {
  return { severity: "warning", message, code };
}

export function errorDiagnostic(message: string, code?: string): ToolDiagnostic {
  return { severity: "error", message, code };
}

export function okEnvelope<T extends Record<string, unknown>>(args: {
  tool: string;
  summary: string;
  data: T;
  classification?: string;
  diagnostics?: ToolDiagnostic[];
  stale?: boolean;
  provenance?: Record<string, unknown>;
}): ToolEnvelope<T> {
  return {
    tool: args.tool,
    ok: true,
    classification: args.classification ?? "ok",
    summary: args.summary,
    data: args.data,
    diagnostics: args.diagnostics ?? [],
    stale: args.stale,
    provenance: args.provenance,
  };
}

export function errorEnvelope<T extends Record<string, unknown>>(args: {
  tool: string;
  summary: string;
  data: T;
  classification?: string;
  diagnostics?: ToolDiagnostic[];
  stale?: boolean;
  provenance?: Record<string, unknown>;
}): ToolEnvelope<T> {
  return {
    tool: args.tool,
    ok: false,
    classification: args.classification ?? "tool-error",
    summary: args.summary,
    data: args.data,
    diagnostics: args.diagnostics ?? [errorDiagnostic(args.summary)],
    stale: args.stale,
    provenance: args.provenance,
  };
}

export function missingPathToolError(kind: "file" | "directory", path: string): ToolInvocationError<{ path: string }> {
  const message = `${kind === "file" ? "File" : "Directory"} not found: ${path}`;
  return new ToolInvocationError({
    message,
    classification: "not-found",
    diagnostics: [errorDiagnostic(message, "not-found")],
    data: { path },
  });
}

/** Return a staleness warning if the loaded file was modified on disk. */
export function stalenessWarning(session: AgdaSession): string {
  if (session.isFileStale()) {
    return "**Warning:** File modified since last load — results may be stale. Run `agda_load` to refresh.\n\n";
  }
  return "";
}

/** MCP text content helper. */
export function text(t: string): ToolResult<{ text: string }> {
  return makeToolResult(
    okEnvelope({
      tool: "text",
      summary: t,
      data: { text: t },
    }),
    t,
  );
}

/**
 * Validate a goalId against the session's current goals.
 * Returns an error response if invalid, or null if valid.
 */
export function validateGoalId(
  session: AgdaSession,
  goalId: number,
  tool = "unknown",
): ToolResult | null {
  const loaded = session.getLoadedFile();
  if (!loaded) {
    return makeToolResult(
      errorEnvelope({
        tool,
        summary: "No file loaded. Call `agda_load` first.",
        classification: "no-loaded-file",
        data: { goalId },
      }),
    );
  }
  const ids = session.getGoalIds();
  if (!ids.includes(goalId)) {
    const available = ids.length > 0
      ? ids.map((id) => `?${id}`).join(", ")
      : "(none)";
    return makeToolResult(
      errorEnvelope({
        tool,
        summary: `Invalid goal ID ?${goalId}. Available goals: ${available}`,
        classification: "invalid-goal",
        data: { text: "", goalId, availableGoalIds: ids },
        diagnostics: [
          errorDiagnostic(
            `Invalid goal ID ?${goalId}. Available goals: ${available}`,
            "invalid-goal",
          ),
          infoDiagnostic(
            "Run `agda_load` to refresh goals after modifying the file.",
            "reload-hint",
          ),
        ],
      }),
      `Invalid goal ID ?${goalId}. Available goals: ${available}\n\n` +
      "Hint: Run `agda_load` to refresh goals after modifying the file.",
    );
  }
  return null;
}

function toToolInvocationError(err: unknown): ToolInvocationError {
  if (err instanceof ToolInvocationError) {
    return err;
  }

  if (err instanceof PathSandboxError) {
    return new ToolInvocationError({
      message: err.message,
      classification: "invalid-path",
      diagnostics: [errorDiagnostic(err.message, "invalid-path")],
      data: { path: err.targetPath },
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new ToolInvocationError({ message: `Error: ${message}` });
}

function makeTextToolErrorResult(
  tool: string,
  err: unknown,
  defaultData: Record<string, unknown>,
): ToolResult<Record<string, unknown>> {
  const toolError = toToolInvocationError(err);
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: toolError.message,
      classification: toolError.classification,
      data: { ...defaultData, ...toolError.data },
      diagnostics: toolError.diagnostics,
    }),
    toolError.text ?? toolError.message,
  );
}

/**
 * Wrap a session tool handler with staleness warning and error handling.
 * The handler returns a complete structured envelope.
 */
export function wrapStructuredHandler<T extends Record<string, unknown>>(
  tool: string,
  session: AgdaSession,
  handler: () => Promise<{ envelope: ToolEnvelope<T>; text?: string }>,
): () => Promise<ToolResult<Record<string, unknown>>> {
  return async () => {
    try {
      const result = await handler();
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
 */
export function wrapStructuredGoalHandler<A extends Record<string, unknown>, T extends Record<string, unknown>>(
  tool: string,
  session: AgdaSession,
  handler: (args: A & { goalId: number }) => Promise<{ envelope: ToolEnvelope<T>; text?: string }>,
): (args: A & { goalId: number }) => Promise<ToolResult<Record<string, unknown>>> {
  return async (args) => {
    const invalid = validateGoalId(session, args.goalId, tool);
    if (invalid) return invalid;
    try {
      const result = await handler(args);
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

  args.server.registerTool(
    args.name,
    {
      description: args.description,
      inputSchema: args.inputSchema as never,
      outputSchema: toolEnvelopeSchema(args.outputDataSchema),
      annotations: args.annotations,
    },
    args.callback as never,
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
      try {
        const textValue = await args.callback(cbArgs);
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            summary: textValue,
            data: { text: textValue },
          }),
          textValue,
        );
      } catch (err) {
        return makeTextToolErrorResult(args.name, err, { text: "" });
      }
    },
  });
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
      const invalid = validateGoalId(args.session, cbArgs.goalId, args.name);
      if (invalid) {
        return invalid;
      }

      try {
        const warn = stalenessWarning(args.session);
        const body = await args.callback(cbArgs);
        const textValue = warn + body;
        return makeToolResult(
          okEnvelope({
            tool: args.name,
            summary: body,
            data: { text: body, goalId: cbArgs.goalId },
            stale: args.session.isFileStale() || undefined,
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
