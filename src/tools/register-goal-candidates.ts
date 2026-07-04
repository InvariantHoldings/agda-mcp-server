// MIT License — see LICENSE
//
// agda_goal_candidates registration. For every open goal, lists the
// local-context terms that could fill it, type-directed — so an agent can
// see the whole proof state's fillable terms in a single call instead of
// one agda_term_search per goal. Read-only: it only queries each goal's
// type/context (like agda_goal_catalog) and matches types with pure helpers.

import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { logger } from "../agda/logger.js";
import { parseContextEntry, matchTermsByType } from "../agda/goal-analysis.js";
import { makeToolResult, okEnvelope, errorEnvelope, errorDiagnostic, registerStructuredTool } from "./tool-helpers.js";
import { goalIdSchema } from "./tool-schemas.js";

const candidateSchema = z.object({
  name: z.string(),
  type: z.string(),
  match: z.enum(["exact", "result"]),
  arity: z.number(),
});

const goalCandidatesEntrySchema = z.object({
  goalId: goalIdSchema,
  type: z.string(),
  candidateCount: z.number(),
  candidates: z.array(candidateSchema),
});

export const goalCandidatesDataSchema = z.object({
  totalGoals: z.number(),
  goalsWithCandidates: z.number(),
  failedGoalQueries: z.number(),
  goals: z.array(goalCandidatesEntrySchema),
});

const DEFAULT_LIMIT_PER_GOAL = 20;

export function registerGoalCandidates(
  server: McpServer,
  session: AgdaSession,
  _projectRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_goal_candidates",
    description:
      "For every open goal, list local-context terms that can fill it, type-directed: a term whose type IS the goal type (`match: exact`) or whose result type is (`match: result` — apply it to `arity` arguments). Covers the whole proof state in one call. For a module/imported-wide search of a single goal, use `agda_term_search`. Requires a loaded file.",
    category: "proof",
    protocolCommands: ["Cmd_goal_type_context"],
    inputSchema: {
      limitPerGoal: z.number().int().min(1).max(100).optional()
        .describe(`Max candidates per goal (default ${DEFAULT_LIMIT_PER_GOAL})`),
    },
    outputDataSchema: goalCandidatesDataSchema,
    callback: async ({ limitPerGoal }: { limitPerGoal?: number }) => {
      const loadedFile = session.getLoadedFile();
      if (!loadedFile) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_goal_candidates",
            summary: "No file loaded. Call agda_load first.",
            classification: "no-loaded-file",
            data: { totalGoals: 0, goalsWithCandidates: 0, failedGoalQueries: 0, goals: [] },
            diagnostics: [
              errorDiagnostic(
                "No file loaded. Call agda_load first.",
                "no-loaded-file",
                "Load a file with `{!!}` / `?` holes, then re-run to see fillable terms per goal.",
              ),
            ],
          }),
          "No file loaded. Call agda_load first.",
        );
      }

      const limit = limitPerGoal ?? DEFAULT_LIMIT_PER_GOAL;
      const goalIds = session.getGoalIds();
      const goals: Array<z.infer<typeof goalCandidatesEntrySchema>> = [];
      const failedGoalIds = new Set<number>();

      for (const goalId of goalIds) {
        try {
          const info = await session.goal.typeContext(goalId);
          const localCandidates = info.context
            .map(parseContextEntry)
            .filter((entry) => !entry.isImplicit && entry.type)
            .map((entry) => ({ name: entry.name, type: entry.type }));
          const allMatches = matchTermsByType(info.type, localCandidates);
          goals.push({
            goalId,
            type: info.type,
            candidateCount: allMatches.length,
            candidates: allMatches.slice(0, limit),
          });
        } catch (err) {
          failedGoalIds.add(goalId);
          logger.warn("goal_candidates typeContext query failed", {
            goalId,
            error: err instanceof Error ? err.message : String(err),
          });
          goals.push({ goalId, type: "?", candidateCount: 0, candidates: [] });
        }
      }
      const failedGoalQueries = failedGoalIds.size;

      const goalsWithCandidates = goals.filter((goal) => goal.candidateCount > 0).length;

      let text = `## Goal candidates (${goals.length} goal(s))\n\n`;
      if (goals.length === 0) {
        text += "No open goals.\n";
      }
      for (const goal of goals) {
        if (failedGoalIds.has(goal.goalId)) {
          text += `### ?${goal.goalId}\n`;
          text += "_Could not query this goal's type/context — candidates were not computed._\n\n";
          continue;
        }
        text += `### ?${goal.goalId} : \`${goal.type}\`\n`;
        if (goal.candidates.length === 0) {
          text += "_No local term matches the goal type — try `agda_term_search` (module scope) or `agda_auto`._\n\n";
          continue;
        }
        for (const candidate of goal.candidates) {
          const fit = candidate.match === "exact"
            ? "exact"
            : `apply to ${candidate.arity} arg${candidate.arity === 1 ? "" : "s"}`;
          text += `- \`${candidate.name}\` : \`${candidate.type}\` (${fit})\n`;
        }
        if (goal.candidateCount > goal.candidates.length) {
          text += `_…and ${goal.candidateCount - goal.candidates.length} more (raise \`limitPerGoal\`)._\n`;
        }
        text += "\n";
      }

      const warning = failedGoalQueries > 0
        ? `\n⚠️ ${failedGoalQueries}/${goalIds.length} goal queries failed — their candidates are omitted.\n`
        : "";

      return makeToolResult(
        okEnvelope({
          tool: "agda_goal_candidates",
          summary: `${goalsWithCandidates}/${goals.length} goal(s) have a local fillable term${failedGoalQueries > 0 ? ` (${failedGoalQueries} query failures)` : ""}.`,
          data: { totalGoals: goals.length, goalsWithCandidates, failedGoalQueries, goals },
        }),
        text + warning,
      );
    },
  });
}
