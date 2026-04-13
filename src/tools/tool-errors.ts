// MIT License — see LICENSE
//
// Tool invocation error type and helpers. Tools throw a
// ToolInvocationError when they want a specific classification,
// diagnostic list, and data payload surfaced in the error envelope;
// the wrappers in tool-registration.ts catch that exception shape and
// translate it into a final ToolResult via makeTextToolErrorResult.

import { PathSandboxError } from "../repo-root.js";

import {
  errorDiagnostic,
  errorEnvelope,
  makeToolResult,
  type ToolDiagnostic,
  type ToolResult,
} from "./tool-envelope.js";

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

export function missingPathToolError(kind: "file" | "directory", path: string): ToolInvocationError<{ path: string }> {
  const message = `${kind === "file" ? "File" : "Directory"} not found: ${path}`;
  return new ToolInvocationError({
    message,
    classification: "not-found",
    diagnostics: [errorDiagnostic(message, "not-found")],
    data: { path },
  });
}

export function toToolInvocationError(err: unknown): ToolInvocationError {
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

export function makeTextToolErrorResult(
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
