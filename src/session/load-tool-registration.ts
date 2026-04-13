// MIT License — see LICENSE
//
// Load-oriented session tools: agda_load, agda_load_no_metas, agda_typecheck.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative } from "node:path";

import { AgdaSession, filePathDescription, typeCheckBatch } from "../agda-process.js";
import {
  errorDiagnostic,
  errorEnvelope,
  infoDiagnostic,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "../tools/tool-helpers.js";
import {
  loadDataSchema,
  renderLoadLikeText,
  typecheckDataSchema,
} from "./tool-presentation.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import {
  VALID_PROFILE_OPTION_STRINGS,
  validateProfileOptions,
} from "../protocol/profile-options.js";

function missingFileResult(
  tool: "agda_load" | "agda_load_no_metas" | "agda_typecheck",
  filePath: string,
) {
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: `File not found: ${filePath}`,
      classification: "file-not-found",
      data: {
        file: filePath,
        success: false,
        goalIds: [],
        goalCount: 0,
        invisibleGoalCount: 0,
        hasHoles: false,
        isComplete: false,
        classification: "file-not-found",
        errors: [`File not found: ${filePath}`],
        warnings: [],
        profiling: null,
        ...(tool === "agda_typecheck"
          ? {}
          : { reloaded: false, staleBeforeLoad: false }),
      },
    }),
  );
}

function processErrorResult(
  tool: "agda_load" | "agda_load_no_metas" | "agda_typecheck",
  file: string,
  message: string,
) {
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "process-error",
      data: {
        file,
        success: false,
        goalIds: [],
        goalCount: 0,
        invisibleGoalCount: 0,
        hasHoles: false,
        isComplete: false,
        classification: "process-error",
        errors: [message],
        warnings: [],
        profiling: null,
        ...(tool === "agda_typecheck"
          ? {}
          : { reloaded: false, staleBeforeLoad: false }),
      },
    }),
    message,
  );
}

function invalidPathResult(
  tool: "agda_load" | "agda_load_no_metas" | "agda_typecheck",
  file: string,
) {
  const message = `Invalid file path: ${file}`;
  return makeToolResult(
    errorEnvelope({
      tool,
      summary: message,
      classification: "invalid-path",
      data: {
        file,
        success: false,
        goalIds: [],
        goalCount: 0,
        invisibleGoalCount: 0,
        hasHoles: false,
        isComplete: false,
        classification: "invalid-path",
        errors: [message],
        warnings: [],
        profiling: null,
        ...(tool === "agda_typecheck"
          ? {}
          : { reloaded: false, staleBeforeLoad: false }),
      },
      diagnostics: [errorDiagnostic(message, "invalid-path")],
    }),
    message,
  );
}

type PathResolver = (repoRoot: string, file: string) => string;

function resolveRequestedFilePath(
  repoRoot: string,
  file: string,
  resolveInputFile: PathResolver,
): string {
  try {
    return resolveInputFile(repoRoot, file);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      throw err;
    }
    throw err;
  }
}

export function registerSessionLoadTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
  options: {
    resolveInputFile?: PathResolver;
  } = {},
): void {
  const resolveInputFile = options.resolveInputFile ?? resolveFileWithinRoot;
  // filePathDescription takes AgdaVersion | undefined (not null), hence ?? undefined.
  const detectedVersion = session.getAgdaVersion() ?? undefined;

  registerStructuredTool({
    server,
    name: "agda_load",
    description: "Load and type-check an Agda file. This establishes the interactive session — subsequent commands operate on the loaded file's goals.",
    category: "session",
    protocolCommands: ["Cmd_load", "Cmd_metas"],
    inputSchema: {
      file: z.string().describe(filePathDescription(detectedVersion)),
      profileOptions: z.array(z.string()).optional().describe(
        `Agda profiling options. Valid values: ${VALID_PROFILE_OPTION_STRINGS.join(", ")}. ` +
        "Note: internal, modules, and definitions are mutually exclusive.",
      ),
    },
    outputDataSchema: loadDataSchema,
    callback: async ({ file, profileOptions }: { file: string; profileOptions?: string[] }) => {
      const startMs = performance.now();

      // Validate profile options first — client-side input validation should fail fast
      if (profileOptions && profileOptions.length > 0) {
        const validation = validateProfileOptions(profileOptions);
        if (!validation.valid) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_load",
              summary: `Invalid profile options: ${validation.errors.join("; ")}`,
              classification: "invalid-profile-options",
              data: {
                file,
                success: false,
                goalIds: [],
                goalCount: 0,
                invisibleGoalCount: 0,
                hasHoles: false,
                isComplete: false,
                classification: "invalid-profile-options",
                errors: validation.errors,
                warnings: [],
                reloaded: false,
                staleBeforeLoad: false,
                profiling: null,
              },
              diagnostics: validation.errors.map((msg) => errorDiagnostic(msg, "invalid-profile-option")),
            }),
          );
        }
      }

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

  registerStructuredTool({
    server,
    name: "agda_load_no_metas",
    description: "Load and type-check an Agda file, failing if unsolved metavariables remain after loading. Note: Cmd_load_no_metas does not accept command-line options, so Agda profiling options cannot be passed directly. Use agda_load with profileOptions for profiled type-checking.",
    category: "session",
    protocolCommands: ["Cmd_load_no_metas"],
    inputSchema: {
      file: z.string().describe(filePathDescription(detectedVersion)),
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

  registerStructuredTool({
    server,
    name: "agda_typecheck",
    description: "Quick batch type-check of an Agda file (stateless — does not establish an interactive session). Use agda_load for interactive proof work.",
    category: "session",
    protocolCommands: ["Cmd_load", "Cmd_metas"],
    inputSchema: {
      file: z.string().describe(filePathDescription(detectedVersion)),
      profileOptions: z.array(z.string()).optional().describe(
        `Agda profiling options. Valid values: ${VALID_PROFILE_OPTION_STRINGS.join(", ")}. ` +
        "Note: internal, modules, and definitions are mutually exclusive.",
      ),
    },
    outputDataSchema: typecheckDataSchema,
    callback: async ({ file, profileOptions }: { file: string; profileOptions?: string[] }) => {
      const startMs = performance.now();

      // Validate profile options first — client-side input validation should fail fast
      if (profileOptions && profileOptions.length > 0) {
        const validation = validateProfileOptions(profileOptions);
        if (!validation.valid) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_typecheck",
              summary: `Invalid profile options: ${validation.errors.join("; ")}`,
              classification: "invalid-profile-options",
              data: {
                file,
                success: false,
                goalIds: [],
                goalCount: 0,
                invisibleGoalCount: 0,
                hasHoles: false,
                isComplete: false,
                classification: "invalid-profile-options",
                errors: validation.errors,
                warnings: [],
                profiling: null,
              },
              diagnostics: validation.errors.map((msg) => errorDiagnostic(msg, "invalid-profile-option")),
            }),
          );
        }
      }

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
        const result = await typeCheckBatch(filePath, repoRoot, { profileOptions });
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
