// MIT License — see LICENSE
//
// Reporting and introspection tools: tool catalog and bug bundles.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgdaSession } from "../agda-process.js";
import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../protocol/parity-matrix.js";
import { getServerVersion } from "../server-version.js";
import { buildBugReportBundle } from "../reporting/bug-report.js";
import { listToolManifest } from "./manifest.js";
import {
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "./tool-helpers.js";

const manifestEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  protocolCommands: z.array(z.string()),
  inputFields: z.array(z.string()),
  outputFields: z.array(z.string()),
});

const toolsCatalogDataSchema = z.object({
  serverVersion: z.string(),
  tools: z.array(manifestEntrySchema),
});

const protocolParityEntrySchema = z.object({
  agdaCommand: z.string(),
  category: z.string(),
  exposure: z.string(),
  implemented: z.boolean(),
  mcpTool: z.string().optional(),
  parityStatus: z.enum(["verified", "mapped", "known-gap"]),
  coverageLevel: z.enum(["none", "unit", "integration", "mcp"]),
  notes: z.string().optional(),
  issues: z.array(z.number()),
});

const protocolParityDataSchema = z.object({
  serverVersion: z.string(),
  source: z.string(),
  verifiedAt: z.string(),
  upstreamCommandCount: z.number(),
  trackedCommandCount: z.number(),
  verifiedCount: z.number(),
  mappedCount: z.number(),
  knownGapCount: z.number(),
  knownGaps: z.array(protocolParityEntrySchema),
  entries: z.array(protocolParityEntrySchema),
});

const bugDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  code: z.string().optional(),
});

const bugBundleSchema = z.object({
  kind: z.enum(["new-bug", "update", "regression"]),
  bugFingerprint: z.string(),
  title: z.string(),
  affectedTool: z.string(),
  classification: z.string(),
  agdaCommandFamily: z.string().optional(),
  serverVersion: z.string(),
  agdaVersion: z.string().optional(),
  environment: z.record(z.string(), z.string()),
  reproduction: z.array(z.string()),
  observed: z.string(),
  expected: z.string(),
  diagnostics: z.array(bugDiagnosticSchema),
  evidence: z.record(z.string(), z.unknown()),
  toolPayload: z.record(z.string(), z.unknown()).optional(),
  existingIssue: z.number().optional(),
});

async function tryGetAgdaVersion(session: AgdaSession): Promise<string | undefined> {
  try {
    const result = await session.query.showVersion();
    return result.version || undefined;
  } catch {
    return undefined;
  }
}

function renderBugBundleText(
  label: string,
  bundle: z.infer<typeof bugBundleSchema>,
): string {
  let output = `## ${label}\n\n`;
  output += `**Title:** ${bundle.title}\n`;
  output += `**Fingerprint:** ${bundle.bugFingerprint}\n`;
  output += `**Tool:** ${bundle.affectedTool}\n`;
  output += `**Classification:** ${bundle.classification}\n`;
  if (bundle.existingIssue !== undefined) {
    output += `**Existing issue:** #${bundle.existingIssue}\n`;
  }
  output += `**Server version:** ${bundle.serverVersion}\n`;
  if (bundle.agdaVersion) {
    output += `**Agda version:** ${bundle.agdaVersion}\n`;
  }
  output += "\n### Observed\n";
  output += `${bundle.observed}\n\n`;
  output += "### Expected\n";
  output += `${bundle.expected}\n\n`;
  output += "### Reproduction\n";
  for (const step of bundle.reproduction) {
    output += `- ${step}\n`;
  }
  if (bundle.diagnostics.length > 0) {
    output += "\n### Diagnostics\n";
    for (const diagnostic of bundle.diagnostics) {
      output += `- [${diagnostic.severity}] ${diagnostic.code ? `${diagnostic.code}: ` : ""}${diagnostic.message}\n`;
    }
  }
  return output;
}

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_tools_catalog",
    description: "Return the generated manifest view of exposed MCP tools, categories, protocol mappings, and schema field names.",
    category: "reporting",
    outputDataSchema: toolsCatalogDataSchema,
    callback: async () => {
      const tools = listToolManifest();
      const serverVersion = getServerVersion();
      let output = "## Tool catalog\n\n";
      output += `**Server version:** ${serverVersion}\n\n`;
      for (const tool of tools) {
        const commands = tool.protocolCommands.length > 0
          ? tool.protocolCommands.join(", ")
          : "(none)";
        output += `- \`${tool.name}\` [${tool.category}] — ${commands}\n`;
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_tools_catalog",
          summary: `Catalogued ${tools.length} tools.`,
          data: {
            serverVersion,
            tools,
          },
        }),
        output,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_protocol_parity",
    description: "Return the current Agda IOTCM parity matrix, distinguishing mapped commands from semantically verified commands and known gaps.",
    category: "reporting",
    outputDataSchema: protocolParityDataSchema,
    callback: async () => {
      const summary = getProtocolParitySummary();
      const entries = listProtocolParityMatrix();
      const knownGaps = getKnownProtocolGaps();
      const serverVersion = getServerVersion();

      let output = "## Protocol parity\n\n";
      output += `**Server version:** ${serverVersion}\n`;
      output += `**Upstream source:** ${summary.source}\n`;
      output += `**Verified at:** ${summary.verifiedAt}\n`;
      output += `**Tracked commands:** ${summary.trackedCommandCount}/${summary.upstreamCommandCount}\n`;
      output += `**Verified:** ${summary.verifiedCount}\n`;
      output += `**Mapped:** ${summary.mappedCount}\n`;
      output += `**Known gaps:** ${summary.knownGapCount}\n\n`;

      if (knownGaps.length > 0) {
        output += "### Known gaps\n";
        for (const entry of knownGaps) {
          const issueText = entry.issues.length > 0
            ? ` (#${entry.issues.join(", #")})`
            : "";
          output += `- \`${entry.agdaCommand}\` -> \`${entry.mcpTool ?? "(no MCP tool)"}\`${issueText}\n`;
        }
        output += "\n";
      }

      output += "### Matrix\n";
      for (const entry of entries) {
        output += `- \`${entry.agdaCommand}\` [${entry.parityStatus}/${entry.coverageLevel}]`;
        if (entry.mcpTool) {
          output += ` -> \`${entry.mcpTool}\``;
        }
        if (entry.notes) {
          output += ` — ${entry.notes}`;
        }
        output += "\n";
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_protocol_parity",
          summary: `Tracked ${summary.trackedCommandCount} Agda commands with ${summary.knownGapCount} known gaps.`,
          data: {
            serverVersion,
            ...summary,
            knownGaps,
            entries,
          },
        }),
        output,
      );
    },
  });

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
    callback: async ({
      kind,
      affectedTool,
      classification,
      observed,
      expected,
      reproduction,
      diagnostics,
      evidence,
      toolPayload,
      agdaCommandFamily,
      title,
      environment,
    }: {
      kind?: "new-bug" | "regression";
      affectedTool: string;
      classification: string;
      observed: string;
      expected: string;
      reproduction: string[];
      diagnostics?: Array<{ severity: "error" | "warning" | "info"; message: string; code?: string }>;
      evidence?: Record<string, unknown>;
      toolPayload?: Record<string, unknown>;
      agdaCommandFamily?: string;
      title?: string;
      environment?: Record<string, string>;
    }) => {
      try {
        const bundle = buildBugReportBundle({
          kind: kind ?? "new-bug",
          affectedTool,
          classification,
          observed,
          expected,
          reproduction,
          diagnostics,
          evidence,
          toolPayload,
          agdaCommandFamily,
          title,
          environment,
          serverVersion: getServerVersion(),
          agdaVersion: await tryGetAgdaVersion(session),
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_bug_report_bundle",
            summary: `Built bug bundle ${bundle.bugFingerprint} for ${affectedTool}.`,
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
            data: {
              kind: kind ?? "new-bug",
              bugFingerprint: "",
              title: title ?? "",
              affectedTool,
              classification,
              serverVersion: getServerVersion(),
              environment: environment ?? {},
              reproduction,
              observed,
              expected,
              diagnostics: diagnostics ?? [],
              evidence: evidence ?? {},
              toolPayload,
              agdaCommandFamily,
            },
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_bug_report_update_bundle",
    description: "Emit a structured update bundle for an existing bug report, preserving stable fingerprints and issue linkage.",
    category: "reporting",
    inputSchema: {
      existingIssue: z.number().describe("Existing GitHub issue number"),
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
    callback: async ({
      existingIssue,
      affectedTool,
      classification,
      observed,
      expected,
      reproduction,
      diagnostics,
      evidence,
      toolPayload,
      agdaCommandFamily,
      title,
      environment,
    }: {
      existingIssue: number;
      affectedTool: string;
      classification: string;
      observed: string;
      expected: string;
      reproduction: string[];
      diagnostics?: Array<{ severity: "error" | "warning" | "info"; message: string; code?: string }>;
      evidence?: Record<string, unknown>;
      toolPayload?: Record<string, unknown>;
      agdaCommandFamily?: string;
      title?: string;
      environment?: Record<string, string>;
    }) => {
      try {
        const bundle = buildBugReportBundle({
          kind: "update",
          existingIssue,
          affectedTool,
          classification,
          observed,
          expected,
          reproduction,
          diagnostics,
          evidence,
          toolPayload,
          agdaCommandFamily,
          title,
          environment,
          serverVersion: getServerVersion(),
          agdaVersion: await tryGetAgdaVersion(session),
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_bug_report_update_bundle",
            summary: `Built update bundle ${bundle.bugFingerprint} for issue #${existingIssue}.`,
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
            data: {
              kind: "update",
              bugFingerprint: "",
              title: title ?? "",
              affectedTool,
              classification,
              serverVersion: getServerVersion(),
              environment: environment ?? {},
              reproduction,
              observed,
              expected,
              diagnostics: diagnostics ?? [],
              evidence: evidence ?? {},
              toolPayload,
              agdaCommandFamily,
              existingIssue,
            },
          }),
          message,
        );
      }
    },
  });
}
