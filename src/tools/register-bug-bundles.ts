// MIT License — see LICENSE
//
// agda_bug_report_bundle and agda_bug_report_update_bundle
// registration. Both tools serialize bug / regression data into a
// structured bundle suitable for GitHub issue filing or in-tree
// triage, with a stable fingerprint that lets update bundles link
// back to an existing issue.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgdaSession } from "../agda-process.js";
import { buildBugReportBundle } from "../reporting/bug-report.js";
import { getServerVersion } from "../server-version.js";

import {
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "./tool-helpers.js";
import {
  bugBundleSchema,
  bugDiagnosticSchema,
  renderBugBundleText,
  tryGetAgdaVersion,
} from "./reporting-schemas.js";

type BugDiagnosticInput = Array<{
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}>;

interface BugBundleCommonArgs {
  affectedTool: string;
  classification: string;
  observed: string;
  expected: string;
  reproduction: string[];
  diagnostics?: BugDiagnosticInput;
  evidence?: Record<string, unknown>;
  toolPayload?: Record<string, unknown>;
  agdaCommandFamily?: string;
  title?: string;
  environment?: Record<string, string>;
}

function baseErrorData(args: BugBundleCommonArgs & {
  kind: "new-bug" | "regression" | "update";
  existingIssue?: number;
}): z.infer<typeof bugBundleSchema> {
  return {
    kind: args.kind,
    bugFingerprint: "",
    title: args.title ?? "",
    affectedTool: args.affectedTool,
    classification: args.classification,
    serverVersion: getServerVersion(),
    environment: args.environment ?? {},
    reproduction: args.reproduction,
    observed: args.observed,
    expected: args.expected,
    diagnostics: args.diagnostics ?? [],
    evidence: args.evidence ?? {},
    toolPayload: args.toolPayload,
    agdaCommandFamily: args.agdaCommandFamily,
    existingIssue: args.existingIssue,
  };
}

export function registerBugReportBundle(server: McpServer, session: AgdaSession): void {
  registerStructuredTool({
    server,
    name: "agda_bug_report_bundle",
    description: "Emit a structured bundle for a new bug report or regression, suitable for issue filing or later updates.",
    category: "reporting",
    inputSchema: {
      kind: z.enum(["new-bug", "regression"]).optional().describe("Bundle kind. Defaults to new-bug."),
      affectedTool: z.string().describe("The MCP tool affected by the bug"),
      classification: z.string().describe("Normalized classification, such as ok-with-holes or process-error"),
      observed: z.string().describe("Observed behavior"),
      expected: z.string().describe("Expected behavior"),
      reproduction: z.array(z.string()).describe("Ordered reproduction steps"),
      diagnostics: z.array(bugDiagnosticSchema).optional().describe("Normalized diagnostics from tool output"),
      evidence: z.record(z.string(), z.unknown()).optional().describe("Structured supporting evidence"),
      toolPayload: z.record(z.string(), z.unknown()).optional().describe("Structured tool payload, if available"),
      agdaCommandFamily: z.string().optional().describe("Agda command family or primary protocol command"),
      title: z.string().optional().describe("Optional explicit issue title"),
      environment: z.record(z.string(), z.string()).optional().describe("Environment metadata such as OS or Node version"),
    },
    outputDataSchema: bugBundleSchema,
    callback: async (inputs: {
      kind?: "new-bug" | "regression";
    } & BugBundleCommonArgs) => {
      const kind = inputs.kind ?? "new-bug";
      try {
        const bundle = buildBugReportBundle({
          kind,
          affectedTool: inputs.affectedTool,
          classification: inputs.classification,
          observed: inputs.observed,
          expected: inputs.expected,
          reproduction: inputs.reproduction,
          diagnostics: inputs.diagnostics,
          evidence: inputs.evidence,
          toolPayload: inputs.toolPayload,
          agdaCommandFamily: inputs.agdaCommandFamily,
          title: inputs.title,
          environment: inputs.environment,
          serverVersion: getServerVersion(),
          agdaVersion: await tryGetAgdaVersion(session),
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_bug_report_bundle",
            summary: `Built bug bundle ${bundle.bugFingerprint} for ${inputs.affectedTool}.`,
            classification: bundle.classification,
            data: { ...bundle },
          }),
          renderBugBundleText("Bug Report Bundle", bundle),
        );
      } catch (err) {
        const message = `Bug bundle generation failed: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_bug_report_bundle",
            summary: message,
            classification: "tool-error",
            data: baseErrorData({ ...inputs, kind }),
          }),
          message,
        );
      }
    },
  });
}

export function registerBugReportUpdateBundle(server: McpServer, session: AgdaSession): void {
  registerStructuredTool({
    server,
    name: "agda_bug_report_update_bundle",
    description: "Emit a structured update bundle for an existing bug report, preserving stable fingerprints and issue linkage.",
    category: "reporting",
    inputSchema: {
      existingIssue: z.number().int().min(1).describe("Existing GitHub issue number (positive integer)"),
      affectedTool: z.string().describe("The MCP tool affected by the bug"),
      classification: z.string().describe("Normalized classification"),
      observed: z.string().describe("Observed behavior"),
      expected: z.string().describe("Expected behavior"),
      reproduction: z.array(z.string()).describe("Ordered reproduction steps"),
      diagnostics: z.array(bugDiagnosticSchema).optional().describe("Normalized diagnostics from tool output"),
      evidence: z.record(z.string(), z.unknown()).optional().describe("Structured supporting evidence"),
      toolPayload: z.record(z.string(), z.unknown()).optional().describe("Structured tool payload, if available"),
      agdaCommandFamily: z.string().optional().describe("Agda command family or primary protocol command"),
      title: z.string().optional().describe("Optional explicit issue title"),
      environment: z.record(z.string(), z.string()).optional().describe("Environment metadata such as OS or Node version"),
    },
    outputDataSchema: bugBundleSchema,
    callback: async (inputs: {
      existingIssue: number;
    } & BugBundleCommonArgs) => {
      try {
        const bundle = buildBugReportBundle({
          kind: "update",
          existingIssue: inputs.existingIssue,
          affectedTool: inputs.affectedTool,
          classification: inputs.classification,
          observed: inputs.observed,
          expected: inputs.expected,
          reproduction: inputs.reproduction,
          diagnostics: inputs.diagnostics,
          evidence: inputs.evidence,
          toolPayload: inputs.toolPayload,
          agdaCommandFamily: inputs.agdaCommandFamily,
          title: inputs.title,
          environment: inputs.environment,
          serverVersion: getServerVersion(),
          agdaVersion: await tryGetAgdaVersion(session),
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_bug_report_update_bundle",
            summary: `Built update bundle ${bundle.bugFingerprint} for issue #${inputs.existingIssue}.`,
            classification: bundle.classification,
            data: { ...bundle },
          }),
          renderBugBundleText("Bug Update Bundle", bundle),
        );
      } catch (err) {
        const message = `Bug update bundle generation failed: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_bug_report_update_bundle",
            summary: message,
            classification: "tool-error",
            data: baseErrorData({
              ...inputs,
              kind: "update",
              existingIssue: inputs.existingIssue,
            }),
          }),
          message,
        );
      }
    },
  });
}
