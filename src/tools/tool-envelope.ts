// MIT License — see LICENSE
//
// Tool envelope types, diagnostic constructors, and envelope builders.
//
// The tool envelope is the shared structured-output shape every MCP tool
// returns: it carries the primary data, a classification string, a list
// of severity-tagged diagnostics, optional provenance, optional wall-
// clock elapsedMs telemetry, and a human-readable summary. Tools use
// `okEnvelope` for happy-path results and `errorEnvelope` for failures;
// both run the provenance merge so process-wide metadata always lands
// in the final envelope without the tool having to re-assemble it.

import { z } from "zod";

import { mergeProvenance } from "./tool-provenance.js";

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
  /** Wall-clock time for the tool invocation in milliseconds. */
  elapsedMs?: number;
}

export type ToolResult<T extends Record<string, unknown> = Record<string, unknown>> = {
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
  elapsedMs: z.int().nonnegative().optional(),
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
  elapsedMs?: number;
}): ToolEnvelope<T> {
  return {
    tool: args.tool,
    ok: true,
    classification: args.classification ?? "ok",
    summary: args.summary,
    data: args.data,
    diagnostics: args.diagnostics ?? [],
    stale: args.stale,
    provenance: mergeProvenance(args.provenance),
    elapsedMs: args.elapsedMs,
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
  elapsedMs?: number;
}): ToolEnvelope<T> {
  return {
    tool: args.tool,
    ok: false,
    classification: args.classification ?? "tool-error",
    summary: args.summary,
    data: args.data,
    diagnostics: args.diagnostics ?? [errorDiagnostic(args.summary)],
    stale: args.stale,
    provenance: mergeProvenance(args.provenance),
    elapsedMs: args.elapsedMs,
  };
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
