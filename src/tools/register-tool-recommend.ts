// MIT License — see LICENSE
//
// agda_tool_recommend registration. Returns recommended next MCP tool
// calls based on the current semantic session state — ordered by
// priority with rationale and pre-filled arguments.

import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { listToolManifest } from "./manifest.js";
import { deriveToolRecommendations } from "../session/tool-recommendation.js";
import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";

const recommendationSchema = z.object({
  tool: z.string(),
  category: z.string(),
  rationale: z.string(),
  priority: z.number(),
  knownArgs: z.record(z.string(), z.unknown()),
  blockers: z.array(z.string()),
});

export const toolRecommendDataSchema = z.object({
  recommendations: z.array(recommendationSchema),
});

export function registerToolRecommend(
  server: McpServer,
  session: AgdaSession,
  _projectRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_tool_recommend",
    description:
      "Suggest likely next MCP tool calls based on the current semantic proof state. Returns recommendations ordered by priority with rationale, pre-filled arguments, and blockers.",
    category: "reporting",
    outputDataSchema: toolRecommendDataSchema,
    callback: async () => {
      const loadedFile = session.getLoadedFile();

      const recommendations = deriveToolRecommendations({
        phase: session.getPhase(),
        loadedFile,
        stale: session.isFileStale(),
        goalIds: session.getGoalIds(),
        classification: session.getLastClassification(),
        availableTools: listToolManifest(),
      });

      let text = `## Tool Recommendations\n\n`;
      if (recommendations.length === 0) {
        text += "_No specific recommendations for the current state._\n";
      } else {
        for (const rec of recommendations) {
          text += `${rec.priority}. \`${rec.tool}\` [${rec.category}] — ${rec.rationale}`;
          if (Object.keys(rec.knownArgs).length > 0) {
            text += `\n   Known args: ${JSON.stringify(rec.knownArgs)}`;
          }
          if (rec.blockers.length > 0) {
            text += `\n   ⚠️ ${rec.blockers.join("; ")}`;
          }
          text += "\n";
        }
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_tool_recommend",
          summary: `${recommendations.length} recommendation(s).`,
          data: { recommendations },
        }),
        text,
      );
    },
  });
}
