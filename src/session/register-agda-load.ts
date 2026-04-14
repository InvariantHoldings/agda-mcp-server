// MIT License — see LICENSE
//
// agda_load tool registration.
//
// agda_load is the main session-state entry point: it runs Cmd_load,
// waits for the goals response, reconciles post-load metas, updates
// the singleton AgdaSession's currentFile / mtime / goalIds, and
// returns a full structured envelope with the goals/warnings text
// block plus the agent-UX observations doc's §1.3 / §1.4 diagnostics
// (session-regression, scope-check-extent) and the session-history
// fields (previousClassification, previousLoadedAtMs, lastCheckedLine).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import { AgdaSession, filePathDescription } from "../agda-process.js";
import {
  errorDiagnostic,
  infoDiagnostic,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "../tools/tool-helpers.js";
import { loadDataSchema, renderLoadLikeText } from "./tool-presentation.js";
import { PathSandboxError, resolveExistingPathWithinRoot } from "../repo-root.js";
import {
  VALID_PROFILE_OPTION_STRINGS,
  validateProfileOptions,
} from "../protocol/profile-options.js";

import {
  invalidPathResult,
  missingFileResult,
  processErrorResult,
  resolveRequestedFilePath,
  validateProfileOptionsOrError,
  type PathResolver,
} from "./load-tool-shared.js";

export function registerAgdaLoad(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
  resolveInputFile: PathResolver,
): void {
  registerStructuredTool({
    server,
    name: "agda_load",
    description: "Load and type-check an Agda file. This establishes the interactive session — subsequent commands operate on the loaded file's goals.",
    category: "session",
    protocolCommands: ["Cmd_load", "Cmd_metas"],
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      profileOptions: z.array(z.string()).optional().describe(
        `Agda profiling options. Valid values: ${VALID_PROFILE_OPTION_STRINGS.join(", ")}. ` +
        "Note: internal, modules, and definitions are mutually exclusive.",
      ),
    },
    outputDataSchema: loadDataSchema,
    callback: async ({ file, profileOptions }: { file: string; profileOptions?: string[] }) => {
      const startMs = performance.now();

      const profileError = validateProfileOptionsOrError(
        "agda_load",
        file,
        profileOptions,
        validateProfileOptions,
      );
      if (profileError) return profileError;

      let requestedFilePath: string;
      try {
        requestedFilePath = resolveRequestedFilePath(repoRoot, file, resolveInputFile);
      } catch (err) {
        if (!(err instanceof PathSandboxError)) {
          throw err;
        }
        return invalidPathResult("agda_load", file);
      }
      if (!existsSync(requestedFilePath)) {
        return missingFileResult("agda_load", requestedFilePath);
      }

      try {
        const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
        const previousFile = session.getLoadedFile();
        const isReload = previousFile === filePath;
        const wasStale = isReload && session.isFileStale();
        const previousClassification = isReload
          ? (session.getLastClassification?.() ?? null)
          : null;
        const previousLoadedAtMs = isReload
          ? (session.getLastLoadedAt?.() ?? null)
          : null;
        const result = await session.load(filePath, { profileOptions });
        const relPath = relative(repoRoot, requestedFilePath);
        const diagnostics = [
          ...result.errors.map((message) => errorDiagnostic(message, "agda-error")),
          ...result.warnings.map((message) => warningDiagnostic(message, "agda-warning")),
        ];

        if (result.hasHoles) {
          diagnostics.push(
            infoDiagnostic(
              `Detected ${result.goalCount} visible goals and ${result.invisibleGoalCount} invisible goals.`,
              "completeness",
            ),
          );
        }

        const previousWasSuccess = previousClassification === "ok-complete"
          || previousClassification === "ok-with-holes";
        if (isReload && previousWasSuccess && !result.success) {
          const ageSeconds = previousLoadedAtMs !== null
            ? Math.max(0, Math.round((Date.now() - previousLoadedAtMs) / 1000))
            : null;
          const ageSuffix = ageSeconds !== null ? ` ${ageSeconds}s ago` : "";
          diagnostics.push(
            infoDiagnostic(
              `Regression: this file loaded as ${previousClassification}${ageSuffix}. `
                + "It may have been modified since, or a dependency may have changed.",
              "session-regression",
            ),
          );
        }

        // §1.4: when a diagnostic carried a source line location, Agda
        // may have aborted scope-checking at that line — so `hasHoles`
        // and `goalCount` reflect only what was reached before the
        // abort, not the whole file. Surface the line so the caller
        // can decide whether to trust a nominally-clean classification.
        const lastCheckedLine = result.lastCheckedLine ?? null;
        if (lastCheckedLine !== null) {
          const suspectClean = result.success && !result.hasHoles;
          const message = suspectClean
            ? `Load reported ${result.classification} but a diagnostic was emitted at line ${lastCheckedLine}. `
              + "Agda may have aborted scope-checking before reaching every hole in the file — "
              + "treat hasHoles and goalCount as lower bounds."
            : `Earliest diagnostic location in this load: line ${lastCheckedLine}. `
              + "Contents past this line may not have been fully scope-checked.";
          diagnostics.push(infoDiagnostic(message, "scope-check-extent"));
        }

        const textLead = isReload
          ? wasStale
            ? "**Reloading modified file.**"
            : "**Re-type-checking file.**"
          : undefined;

        const elapsedMs = Math.round(performance.now() - startMs);
        const text = renderLoadLikeText({
          heading: "Loaded",
          file: relPath,
          success: result.success,
          classification: result.classification,
          goalIds: result.goals.map((goal) => goal.goalId),
          goalCount: result.goalCount,
          invisibleGoalCount: result.invisibleGoalCount,
          errors: result.errors,
          warnings: result.warnings,
          reloaded: isReload,
          staleBeforeLoad: wasStale,
          extraLead: textLead,
          profiling: result.profiling,
          elapsedMs,
        });

        const renderedText = result.allGoalsText
          ? `${text}### Goals & Warnings\n\`\`\`\n${result.allGoalsText}\n\`\`\`\n`
          : text;

        return makeToolResult(
          okEnvelope({
            tool: "agda_load",
            summary: `Loaded ${relPath} with classification ${result.classification} (${elapsedMs}ms).`,
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
              reloaded: isReload,
              staleBeforeLoad: wasStale,
              profiling: result.profiling,
              previousClassification,
              previousLoadedAtMs,
              lastCheckedLine,
            },
            diagnostics,
            stale: session.isFileStale() || undefined,
            provenance: { file: filePath, protocolCommands: ["Cmd_load", "Cmd_metas"] },
            elapsedMs,
          }),
          renderedText,
        );
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return invalidPathResult("agda_load", file);
        }
        return processErrorResult(
          "agda_load",
          file,
          `Agda load failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
