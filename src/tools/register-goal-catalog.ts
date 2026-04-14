// MIT License — see LICENSE
//
// agda_goal_catalog registration. Returns a structured catalog of all
// goals in the current proof state — types, contexts, splittable
// variables, and per-goal suggestions — so agents can inspect the
// full proof state in one call.

import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { buildGoalCatalog, renderGoalCatalogText } from "../session/goal-catalog.js";
import { makeToolResult, okEnvelope, errorEnvelope, errorDiagnostic, registerStructuredTool } from "./tool-helpers.js";

const contextEntrySchema = z.object({
  name: z.string(),
  type: z.string(),
  isImplicit: z.boolean(),
});

const suggestionSchema = z.object({
  action: z.enum(["give", "refine", "case_split", "auto", "intro"]),
  reason: z.string(),
  expr: z.string().optional(),
  variable: z.string().optional(),
});

const goalEntrySchema = z.object({
  goalId: z.number(),
  type: z.string(),
  context: z.array(contextEntrySchema),
  splittableVariables: z.array(z.string()),
  suggestions: z.array(suggestionSchema),
});

export const goalCatalogDataSchema = z.object({
  goalCount: z.number(),
  invisibleGoalCount: z.number(),
  hasHoles: z.boolean(),
  goals: z.array(goalEntrySchema),
});

export function registerGoalCatalog(
  server: McpServer,
  session: AgdaSession,
  _projectRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_goal_catalog",
    description:
      "Return a structured catalog of all goals in the current proof state: goal IDs, types, contexts, splittable variables, and per-goal suggestions. Requires a file to be loaded.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type_context"],
    outputDataSchema: goalCatalogDataSchema,
    callback: async () => {
      const loadedFile = session.getLoadedFile();
      if (!loadedFile) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_goal_catalog",
            summary: "No file loaded. Call agda_load first.",
            classification: "no-loaded-file",
            data: {
              goalCount: 0,
              invisibleGoalCount: 0,
              hasHoles: false,
              goals: [],
            },
            diagnostics: [
              errorDiagnostic(
                "No file loaded. Call agda_load first.",
                "no-loaded-file",
                "agda_load",
              ),
            ],
          }),
          "No file loaded. Call agda_load first.",
        );
      }

      // Get goal IDs and build catalog from session state
      const goalIds = session.getGoalIds();

      // For each goal, get type and context via goalTypeContext
      const goalInfos: Array<{ goalId: number; type: string; context: string[] }> = [];
      let failedGoalQueries = 0;

      for (const goalId of goalIds) {
        try {
          const info = await session.goal.typeContext(goalId);
          goalInfos.push({
            goalId,
            type: info.type,
            context: info.context,
          });
        } catch {
          // If a goal query fails (stale, etc), include with minimal info
          failedGoalQueries++;
          goalInfos.push({
            goalId,
            type: "?",
            context: [],
          });
        }
      }

      const catalog = buildGoalCatalog({
        goals: goalInfos,
        invisibleGoalCount: session.getInvisibleGoalCount(),
      });

      const text = renderGoalCatalogText(catalog);

      const warningParts: string[] = [];
      if (failedGoalQueries > 0) {
        warningParts.push(
          `⚠️ ${failedGoalQueries}/${goalIds.length} goal queries failed — types shown as "?" may be stale.`,
        );
      }
      const warningText = warningParts.length > 0
        ? "\n" + warningParts.join("\n") + "\n"
        : "";

      return makeToolResult(
        okEnvelope({
          tool: "agda_goal_catalog",
          summary: `${catalog.goalCount} goal(s)${catalog.hasHoles ? " with holes" : ""}${failedGoalQueries > 0 ? ` (${failedGoalQueries} query failures)` : ""}.`,
          data: { ...catalog },
        }),
        text + warningText,
      );
    },
  });
}
