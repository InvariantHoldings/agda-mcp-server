// MIT License — see LICENSE
//
// agda_protocol_parity registration. Returns the current Agda IOTCM
// parity matrix, distinguishing mapped commands from semantically
// verified commands and known gaps. Used by reviewers and agents to
// see exactly which parts of the upstream Agda interaction protocol
// this server has end-to-end coverage for.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getKnownProtocolGaps,
  getProtocolParitySummary,
  listProtocolParityMatrix,
} from "../protocol/parity-matrix.js";
import { getServerVersion } from "../server-version.js";

import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";
import { protocolParityDataSchema } from "./reporting-schemas.js";

export function registerProtocolParity(server: McpServer): void {
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
      output += `**End-to-end:** ${summary.endToEndCount}\n`;
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
}
