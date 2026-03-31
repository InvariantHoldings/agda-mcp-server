// MIT License — see LICENSE
//
// Load-oriented session tools: agda_load, agda_load_no_metas, agda_typecheck.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import { AgdaSession, typeCheckBatch } from "../agda-process.js";
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

function missingFileResult(tool: "agda_load" | "agda_load_no_metas" | "agda_typecheck", filePath: string) {
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
        ...(tool === "agda_typecheck"
          ? {}
          : { reloaded: false, staleBeforeLoad: false }),
      },
    }),
    message,
  );
}

export function registerSessionLoadTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_load",
    description: "Load and type-check an Agda file. This establishes the interactive session — subsequent commands operate on the loaded file's goals.",
    category: "session",
    protocolCommands: ["Cmd_load", "Cmd_metas"],
    inputSchema: {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    outputDataSchema: loadDataSchema,
    callback: async ({ file }: { file: string }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return missingFileResult("agda_load", filePath);
      }

      try {
        const previousFile = session.getLoadedFile();
        const isReload = previousFile === filePath;
        const wasStale = isReload && session.isFileStale();
        const result = await session.load(filePath);
        const relPath = relative(repoRoot, filePath);
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
        });

        const renderedText = result.allGoalsText
          ? `${text}### Goals & Warnings\n\`\`\`\n${result.allGoalsText}\n\`\`\`\n`
          : text;

        return makeToolResult(
          okEnvelope({
            tool: "agda_load",
            summary: `Loaded ${relPath} with classification ${result.classification}.`,
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
            },
            diagnostics,
            stale: session.isFileStale() || undefined,
            provenance: { file: filePath, protocolCommands: ["Cmd_load", "Cmd_metas"] },
          }),
          renderedText,
        );
      } catch (err) {
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
    description: "Load and type-check an Agda file, failing if unsolved metavariables remain after loading.",
    category: "session",
    protocolCommands: ["Cmd_load_no_metas"],
    inputSchema: {
      file: z.string().describe("Path to the .agda file (relative to repo root or absolute)"),
    },
    outputDataSchema: loadDataSchema,
    callback: async ({ file }: { file: string }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return missingFileResult("agda_load_no_metas", filePath);
      }

      try {
        const result = await session.loadNoMetas(filePath);
        const relPath = relative(repoRoot, filePath);
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
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_load_no_metas",
            summary: `Strictly loaded ${relPath} with classification ${result.classification}.`,
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
            },
            diagnostics: [
              ...result.errors.map((message) => errorDiagnostic(message, "agda-error")),
              ...result.warnings.map((message) => warningDiagnostic(message, "agda-warning")),
            ],
            stale: session.isFileStale() || undefined,
            provenance: { file: filePath, protocolCommands: ["Cmd_load_no_metas"] },
          }),
          text,
        );
      } catch (err) {
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
      file: z.string().describe("Path to the .agda file"),
    },
    outputDataSchema: typecheckDataSchema,
    callback: async ({ file }: { file: string }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return missingFileResult("agda_typecheck", filePath);
      }

      try {
        const result = await typeCheckBatch(filePath, repoRoot);
        const relPath = relative(repoRoot, filePath);
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
        });

        return makeToolResult(
          okEnvelope({
            tool: "agda_typecheck",
            summary: `Type-checked ${relPath} with classification ${result.classification}.`,
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
            },
            diagnostics: [
              ...result.errors.map((message) => errorDiagnostic(message, "agda-error")),
              ...result.warnings.map((message) => warningDiagnostic(message, "agda-warning")),
            ],
            provenance: { file: filePath, protocolCommands: ["Cmd_load", "Cmd_metas"] },
          }),
          text,
        );
      } catch (err) {
        return processErrorResult(
          "agda_typecheck",
          file,
          `Agda invocation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
