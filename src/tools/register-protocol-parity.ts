// MIT License — see LICENSE
//
// agda_protocol_parity registration. Returns the current Agda IOTCM
// parity matrix, distinguishing mapped commands from semantically
// verified commands and known gaps. Used by reviewers and agents to
// see exactly which parts of the upstream Agda interaction protocol
// this server has end-to-end coverage for.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../agda-process.js";
import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../protocol/parity-matrix.js";
import {
  classifyAgdaAgainstSupportedRange,
  describeOutOfRangeWarning,
  getServerVersion,
  getSupportedAgdaRange,
} from "../server-version.js";

import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";
import { protocolParityDataSchema } from "./reporting-schemas.js";

export function registerProtocolParity(
  server: McpServer,
  session: AgdaSession,
): void {
  registerStructuredTool({
    server,
    name: "agda_protocol_parity",
    description: "Return the current Agda IOTCM parity matrix, distinguishing mapped commands from semantically verified commands and known gaps. Also reports the declared supported-Agda range and how the detected Agda compares against it.",
    category: "reporting",
    outputDataSchema: protocolParityDataSchema,
    requiresLoadedSession: false,
    callback: async () => {
      const summary = getProtocolParitySummary();
      const entries = listProtocolParityMatrix();
      const knownGaps = getKnownProtocolGaps();
      const serverVersion = getServerVersion();
      const supportedAgdaRange = getSupportedAgdaRange();
      const detectedVersion = session.getAgdaVersion();
      const baseStatus = classifyAgdaAgainstSupportedRange(detectedVersion);
      const warning = describeOutOfRangeWarning(baseStatus);
      // Only attach a status block when at least one side is known —
      // otherwise the field would be a noisy "all-undefined" payload
      // that adds no information for the agent.
      const haveStatus =
        baseStatus.detected !== undefined ||
        supportedAgdaRange.minAgdaVersion !== undefined ||
        supportedAgdaRange.maxTestedAgdaVersion !== undefined;
      const agdaVersionRangeStatus = haveStatus
        ? { ...baseStatus, ...(warning ? { warning } : {}) }
        : undefined;

      let output = "## Protocol parity\n\n";
      output += `**Server version:** ${serverVersion}\n`;
      output += `**Upstream source:** ${summary.source}\n`;
      output += `**Verified at:** ${summary.verifiedAt}\n`;
      output += `**Tracked commands:** ${summary.trackedCommandCount}/${summary.upstreamCommandCount}\n`;
      output += `**End-to-end:** ${summary.endToEndCount}\n`;
      output += `**Verified:** ${summary.verifiedCount}\n`;
      output += `**Mapped:** ${summary.mappedCount}\n`;
      output += `**Known gaps:** ${summary.knownGapCount}\n`;
      if (supportedAgdaRange.minAgdaVersion || supportedAgdaRange.maxTestedAgdaVersion) {
        const min = supportedAgdaRange.minAgdaVersion ?? "(unspecified)";
        const max = supportedAgdaRange.maxTestedAgdaVersion ?? "(unspecified)";
        output += `**Supported Agda range:** ${min} – ${max}\n`;
      }
      if (agdaVersionRangeStatus?.detected) {
        output += `**Detected Agda:** ${agdaVersionRangeStatus.detected} [${agdaVersionRangeStatus.classification}]\n`;
      }
      if (warning) {
        output += `**Warning:** ${warning}\n`;
      }
      output += "\n";

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
            supportedAgdaRange,
            agdaVersionRangeStatus,
          },
        }),
        output,
      );
    },
  });
}
