// MIT License — see LICENSE
//
// agda_load_no_metas tool registration.
//
// Thin variant of agda_load that uses Cmd_load_no_metas, which fails
// the load if any unsolved metavariables remain after scope-checking.
// Cmd_load_no_metas does not accept per-load command-line options, so
// profileOptions is deliberately not exposed here — callers who need
// profiling should use agda_load.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import { AgdaSession } from "../agda-process.js";
import {
  errorDiagnostic,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "../tools/tool-helpers.js";
import { loadDataSchema, renderLoadLikeText } from "./tool-presentation.js";
import { PathSandboxError, resolveExistingPathWithinRoot } from "../repo-root.js";

import {
  invalidPathResult,
  missingFileResult,
  processErrorResult,
  resolveRequestedFilePath,
  type PathResolver,
} from "./load-tool-shared.js";

export function registerAgdaLoadNoMetas(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
  resolveInputFile: PathResolver,
): void {
  registerStructuredTool({
    server,
    name: "agda_load_no_metas",
    description: "Load and type-check an Agda file, failing if unsolved metavariables remain after loading. Note: Cmd_load_no_metas does not accept command-line options, so Agda profiling options cannot be passed directly. Use agda_load with profileOptions for profiled type-checking.",
    category: "session",
    protocolCommands: ["Cmd_load_no_metas"],
    inputSchema: {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    outputDataSchema: loadDataSchema,
    callback: async ({ file }: { file: string }) => {
      const startMs = performance.now();
      let requestedFilePath: string;
      try {
        requestedFilePath = resolveRequestedFilePath(repoRoot, file, resolveInputFile);
      } catch (err) {
        if (!(err instanceof PathSandboxError)) {
          throw err;
        }
        return invalidPathResult("agda_load_no_metas", file);
      }
      if (!existsSync(requestedFilePath)) {
        return missingFileResult("agda_load_no_metas", requestedFilePath);
      }

      try {
        const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
        const result = await session.loadNoMetas(filePath);
        const relPath = relative(repoRoot, requestedFilePath);
        const elapsedMs = Math.round(performance.now() - startMs);
        const text = renderLoadLikeText({
          heading: "Loaded without metas",
          file: relPath,
          success: result.success,
          classification: result.classification,
          goalIds: result.goals.map((goal) => goal.goalId),
          goalCount: result.goalCount,
          invisibleGoalCount: result.invisibleGoalCount,
          errors: result.errors,
          warnings: result.warnings,
          profiling: result.profiling,
          elapsedMs,
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_load_no_metas",
            summary: `Strictly loaded ${relPath} with classification ${result.classification} (${elapsedMs}ms).`,
            classification: result.classification,
            data: {
              file: relPath,
              success: result.success,
              goalIds: result.goals.map((goal) => goal.goalId),
              goalCount: result.goalCount,
              invisibleGoalCount: result.invisibleGoalCount,
              hasHoles: result.hasHoles,
              isComplete: result.isComplete,
              classification: result.classification,
              errors: result.errors,
              warnings: result.warnings,
              reloaded: false,
              staleBeforeLoad: false,
              profiling: result.profiling,
            },
            diagnostics: [
              ...result.errors.map((message) => errorDiagnostic(message, "agda-error")),
              ...result.warnings.map((message) => warningDiagnostic(message, "agda-warning")),
            ],
            stale: session.isFileStale() || undefined,
            provenance: { file: filePath, protocolCommands: ["Cmd_load_no_metas"] },
            elapsedMs,
          }),
          text,
        );
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return invalidPathResult("agda_load_no_metas", file);
        }
        return processErrorResult(
          "agda_load_no_metas",
          file,
          `Agda strict load failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
