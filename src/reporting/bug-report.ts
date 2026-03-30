// MIT License — see LICENSE
//
// Stable bug-report bundle generation for MCP tool failures and regressions.

import { createHash } from "node:crypto";

export type BugReportKind = "new-bug" | "update" | "regression";

export interface BugDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

export interface BugReportBundleInput {
  kind: BugReportKind;
  affectedTool: string;
  classification: string;
  observed: string;
  expected: string;
  reproduction: string[];
  diagnostics?: BugDiagnostic[];
  evidence?: Record<string, unknown>;
  toolPayload?: Record<string, unknown>;
  agdaCommandFamily?: string;
  agdaVersion?: string;
  serverVersion: string;
  environment?: Record<string, string>;
  existingIssue?: number;
  title?: string;
}

export interface BugReportBundle {
  kind: BugReportKind;
  bugFingerprint: string;
  title: string;
  affectedTool: string;
  classification: string;
  agdaCommandFamily?: string;
  serverVersion: string;
  agdaVersion?: string;
  environment: Record<string, string>;
  reproduction: string[];
  observed: string;
  expected: string;
  diagnostics: BugDiagnostic[];
  evidence: Record<string, unknown>;
  toolPayload?: Record<string, unknown>;
  existingIssue?: number;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeValue(record[key])]),
    );
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function fingerprintBugReport(input: Omit<BugReportBundleInput, "title" | "serverVersion"> & {
  serverVersion: string;
}): string {
  const identity = {
    kind: input.kind,
    affectedTool: input.affectedTool,
    classification: input.classification,
    agdaCommandFamily: input.agdaCommandFamily ?? "",
    observed: input.observed.trim(),
    expected: input.expected.trim(),
    reproduction: input.reproduction.map((step) => step.trim()),
    diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code ?? "",
      message: diagnostic.message.trim(),
    })),
    toolPayload: input.toolPayload ?? {},
  };

  return createHash("sha256")
    .update(stableStringify(identity))
    .digest("hex")
    .slice(0, 16);
}

export function defaultBugTitle(input: {
  kind: BugReportKind;
  affectedTool: string;
  classification: string;
  existingIssue?: number;
}): string {
  if (input.kind === "update" && input.existingIssue !== undefined) {
    return `update issue #${input.existingIssue}: ${input.affectedTool} ${input.classification}`;
  }

  if (input.kind === "regression") {
    return `regression: ${input.affectedTool} ${input.classification}`;
  }

  return `bug: ${input.affectedTool} ${input.classification}`;
}

export function buildBugReportBundle(
  input: BugReportBundleInput,
): BugReportBundle {
  const diagnostics = input.diagnostics ?? [];
  const evidence = input.evidence ?? {};
  const environment = input.environment ?? {};
  const bugFingerprint = fingerprintBugReport(input);

  return {
    kind: input.kind,
    bugFingerprint,
    title: input.title
      ?? defaultBugTitle({
        kind: input.kind,
        affectedTool: input.affectedTool,
        classification: input.classification,
        existingIssue: input.existingIssue,
      }),
    affectedTool: input.affectedTool,
    classification: input.classification,
    agdaCommandFamily: input.agdaCommandFamily,
    serverVersion: input.serverVersion,
    agdaVersion: input.agdaVersion,
    environment,
    reproduction: input.reproduction,
    observed: input.observed,
    expected: input.expected,
    diagnostics,
    evidence,
    toolPayload: input.toolPayload,
    existingIssue: input.existingIssue,
  };
}
