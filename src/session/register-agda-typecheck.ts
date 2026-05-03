// MIT License — see LICENSE
//
// agda_typecheck tool registration.
//
// Post-#39, agda_typecheck routes through the shared singleton
// AgdaSession (same as agda_load) so the two tools share one
// authoritative view of currentFile / mtime / _build state. The only
// difference from agda_load is the response shape: this tool omits
// the full goals-and-warnings text block for a smaller payload.
// profileOptions is forwarded to Cmd_load so callers can still profile
// the typecheck path.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import { AgdaSession, filePathDescription } from "../agda-process.js";
import {
  errorDiagnostic,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "../tools/tool-helpers.js";
import { renderLoadLikeText, typecheckDataSchema } from "./tool-presentation.js";
import { PathSandboxError, resolveExistingPathWithinRoot } from "../repo-root.js";
import {
  VALID_PROFILE_OPTION_STRINGS,
  validateProfileOptions,
} from "../protocol/profile-options.js";
import { COMMON_AGDA_FLAGS } from "../protocol/command-line-options.js";
import {
  effectiveProjectFlags,
  loadProjectConfig,
  mergeCommandLineOptions,
} from "./project-config.js";

import {
  invalidPathResult,
  missingFileResult,
  processErrorResult,
  resolveRequestedFilePath,
  validateProfileOptionsOrError,
  validateCommandLineOptionsOrError,
  type PathResolver,
} from "./load-tool-shared.js";

export function registerAgdaTypecheck(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
  resolveInputFile: PathResolver,
): void {
  registerStructuredTool({
    server,
    name: "agda_typecheck",
    description: "Type-check an Agda file and return a compact classification-only response. This routes through the same singleton session as agda_load (since issue #39) — it updates the session's loaded file, goal IDs, and mtime, so subsequent tool calls operate on the typechecked file. The only difference from agda_load is the response shape: agda_typecheck omits the full goals-and-warnings text block for a smaller payload. If you want the interactive goals listing, call agda_load instead.",
    category: "session",
    protocolCommands: ["Cmd_load", "Cmd_metas"],
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      profileOptions: z.array(z.string()).optional().describe(
        `Agda profiling options. Valid values: ${VALID_PROFILE_OPTION_STRINGS.join(", ")}. ` +
        "Note: internal, modules, and definitions are mutually exclusive.",
      ),
      commandLineOptions: z.array(z.string()).optional().describe(
        "Agda command-line flags passed to Cmd_load (e.g. ['--Werror', '--safe', '--without-K']). " +
        "Merged with project defaults from .agda-mcp.json. " +
        `Common flags: ${COMMON_AGDA_FLAGS.slice(0, 10).join(", ")}, ...`,
      ),
    },
    outputDataSchema: typecheckDataSchema,
    callback: async ({ file, profileOptions, commandLineOptions }: { file: string; profileOptions?: string[]; commandLineOptions?: string[] }) => {
      const startMs = performance.now();

      const profileError = validateProfileOptionsOrError(
        "agda_typecheck",
        file,
        profileOptions,
        validateProfileOptions,
      );
      if (profileError) return profileError;

      // Merge per-call options with project-level defaults and env var
      const projectConfig = loadProjectConfig(repoRoot);
      const mergedOptions = mergeCommandLineOptions(
        effectiveProjectFlags(projectConfig),
        commandLineOptions,
      );

      // Validate merged command-line options at tool boundary (consistent
      // with profileOptions: invalid input → errorEnvelope, not okEnvelope).
      const cmdLineError = validateCommandLineOptionsOrError(
        "agda_typecheck",
        file,
        mergedOptions.length > 0 ? mergedOptions : undefined,
      );
      if (cmdLineError) return cmdLineError;

      let requestedFilePath: string;
      try {
        requestedFilePath = resolveRequestedFilePath(repoRoot, file, resolveInputFile);
      } catch (err) {
        if (!(err instanceof PathSandboxError)) {
          throw err;
        }
        return invalidPathResult("agda_typecheck", file);
      }
      if (!existsSync(requestedFilePath)) {
        return missingFileResult("agda_typecheck", requestedFilePath);
      }

      try {
        const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
        // Route through the singleton session so agda_typecheck and agda_load
        // share one authoritative view of loaded file + mtime + _build state.
        // See issue #39. profileOptions is forwarded to Cmd_load so a caller
        // can still profile the typecheck path.
        const result = await session.load(filePath, {
          profileOptions,
          commandLineOptions: mergedOptions.length > 0 ? mergedOptions : undefined,
        });
        const relPath = relative(repoRoot, requestedFilePath);
        const elapsedMs = Math.round(performance.now() - startMs);
        const text = renderLoadLikeText({
          heading: "Type-check",
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
            tool: "agda_typecheck",
            summary: `Type-checked ${relPath} with classification ${result.classification} (${elapsedMs}ms).`,
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
              profiling: result.profiling,
            },
            diagnostics: [
              ...result.errors.map((message) => errorDiagnostic(message, "agda-error")),
              ...result.warnings.map((message) => warningDiagnostic(message, "agda-warning")),
              ...projectConfig.warnings.map((w) =>
                warningDiagnostic(
                  `${w.source === "env" ? "env" : "config"}: ${w.message}`,
                  `project-config-${w.source}`,
                ),
              ),
            ],
            provenance: { file: filePath, protocolCommands: ["Cmd_load", "Cmd_metas"] },
            elapsedMs,
          }),
          text,
        );
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return invalidPathResult("agda_typecheck", file);
        }
        return processErrorResult(
          "agda_typecheck",
          file,
          `Agda invocation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
