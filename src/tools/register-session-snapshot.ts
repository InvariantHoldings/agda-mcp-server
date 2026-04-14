// MIT License — see LICENSE
//
// agda_session_snapshot registration. Returns a structured snapshot of
// the current session state for one-call agent introspection.

import { z } from "zod";
import { relative } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { formatVersion } from "../agda/agda-version.js";
import { deriveSessionSnapshot } from "../session/session-snapshot.js";
import { tryGetAgdaVersion } from "./reporting-schemas.js";
import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";

const suggestedActionSchema = z.object({
  tool: z.string(),
  rationale: z.string(),
  priority: z.number(),
});

export const sessionSnapshotDataSchema = z.object({
  phase: z.string(),
  loadedFile: z.string().nullable(),
  projectRoot: z.string(),
  stale: z.boolean(),
  goalCount: z.number(),
  goalIds: z.array(z.number()),
  invisibleGoalCount: z.number(),
  classification: z.string().nullable(),
  isComplete: z.boolean(),
  hasHoles: z.boolean(),
  agdaVersion: z.string().nullable(),
  lastLoadedAt: z.number().nullable(),
  suggestedActions: z.array(suggestedActionSchema),
});

export function registerSessionSnapshot(
  server: McpServer,
  session: AgdaSession,
  projectRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_session_snapshot",
    description:
      "Return a structured snapshot of the current session state: loaded file, phase, goal counts, completeness, staleness, and suggested next actions. Designed for one-call agent introspection.",
    category: "reporting",
    outputDataSchema: sessionSnapshotDataSchema,
    callback: async () => {
      // Trigger version detection if needed
      const detectedVersion = await tryGetAgdaVersion(session);
      const agdaVer = session.getAgdaVersion();
      const agdaVersion = agdaVer ? formatVersion(agdaVer) : detectedVersion ?? null;

      const loadedFile = session.getLoadedFile();
      const relFile = loadedFile ? relative(projectRoot, loadedFile) : null;

      const snapshot = deriveSessionSnapshot({
        phase: session.getPhase(),
        loadedFile: relFile,
        projectRoot,
        stale: session.isFileStale(),
        goalIds: session.getGoalIds(),
        invisibleGoalCount: session.getInvisibleGoalCount(),
        classification: session.getLastClassification(),
        agdaVersion,
        lastLoadedAt: session.getLastLoadedAt(),
      });

      const summaryParts: string[] = [];
      summaryParts.push(`Phase: ${snapshot.phase}`);
      if (snapshot.loadedFile) {
        summaryParts.push(`file: ${snapshot.loadedFile}`);
      }
      if (snapshot.classification) {
        summaryParts.push(snapshot.classification);
      }
      if (snapshot.goalCount > 0) {
        summaryParts.push(`${snapshot.goalCount} goal(s)`);
      }
      if (snapshot.stale) {
        summaryParts.push("STALE");
      }
      const summary = summaryParts.join(", ");

      let text = `## Session Snapshot\n\n`;
      text += `**Phase:** ${snapshot.phase}\n`;
      if (snapshot.loadedFile) {
        text += `**Loaded file:** ${snapshot.loadedFile}\n`;
      }
      if (snapshot.agdaVersion) {
        text += `**Agda version:** ${snapshot.agdaVersion}\n`;
      }
      if (snapshot.classification) {
        text += `**Classification:** ${snapshot.classification}\n`;
      }
      text += `**Goals:** ${snapshot.goalCount} visible`;
      if (snapshot.invisibleGoalCount > 0) {
        text += `, ${snapshot.invisibleGoalCount} invisible`;
      }
      text += "\n";
      text += `**Complete:** ${snapshot.isComplete ? "yes" : "no"}\n`;
      if (snapshot.stale) {
        text += `**⚠️ File is stale** — modified on disk since last load.\n`;
      }

      if (snapshot.suggestedActions.length > 0) {
        text += "\n### Suggested next actions\n\n";
        for (const action of snapshot.suggestedActions) {
          text += `- \`${action.tool}\` — ${action.rationale}\n`;
        }
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_session_snapshot",
          summary,
          data: { ...snapshot },
        }),
        text,
      );
    },
  });
}
