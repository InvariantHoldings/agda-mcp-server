// MIT License — see LICENSE
//
// Shared zod schemas and rendering helpers used by the three
// reporting tools (agda_tools_catalog, agda_protocol_parity,
// agda_bug_report_bundle / _update_bundle). Kept in a sibling module
// so the reporting-tool implementation files stay small and focused
// on their tool callback logic.

import { z } from "zod";

import type { AgdaSession } from "../agda-process.js";

export const manifestEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  protocolCommands: z.array(z.string()),
  inputFields: z.array(z.string()),
  outputFields: z.array(z.string()),
});

export const toolsCatalogDataSchema = z.object({
  serverVersion: z.string(),
  tools: z.array(manifestEntrySchema),
});

export const protocolParityEntrySchema = z.object({
  agdaCommand: z.string(),
  category: z.string(),
  exposure: z.string(),
  implemented: z.boolean(),
  mcpTool: z.string().optional(),
  parityStatus: z.enum(["end-to-end", "verified", "mapped", "known-gap"]),
  coverageLevel: z.enum(["none", "unit", "integration", "mcp"]),
  notes: z.string().optional(),
  issues: z.array(z.number()),
});

export const protocolParityDataSchema = z.object({
  serverVersion: z.string(),
  source: z.string(),
  verifiedAt: z.string(),
  upstreamCommandCount: z.number(),
  trackedCommandCount: z.number(),
  endToEndCount: z.number(),
  verifiedCount: z.number(),
  mappedCount: z.number(),
  knownGapCount: z.number(),
  knownGaps: z.array(protocolParityEntrySchema),
  entries: z.array(protocolParityEntrySchema),
});

export const bugDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  code: z.string().optional(),
});

export const bugBundleSchema = z.object({
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

export async function tryGetAgdaVersion(session: AgdaSession): Promise<string | undefined> {
  try {
    const result = await session.query.showVersion();
    return result.version || undefined;
  } catch {
    return undefined;
  }
}

export function renderBugBundleText(
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
