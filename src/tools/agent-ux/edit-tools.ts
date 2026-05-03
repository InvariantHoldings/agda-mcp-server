// MIT License — see LICENSE
//
// Single-file edit tools (rename, missing-clause stub, fixity-conflict
// hints) and the error-triage helper they cooperate with. Every
// write-capable tool routes its post-edit reload through
// `session.load()` so project-config defaults and warnings flow
// uniformly through `LoadResult.projectConfigWarnings`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import {
  applyScopedRename,
  buildMissingClause,
  classifyAgdaError,
  inferFixityConflicts,
  inferMissingClauseArity,
  rewriteCompilerPlaceholders,
} from "../../agda/agent-ux.js";
import { filePathDescription } from "../../agda/version-support.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../../repo-root.js";
import { projectConfigDiagnostics } from "../../session/project-config-diagnostics.js";
import {
  errorDiagnostic,
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  type ToolDiagnostic,
  warningDiagnostic,
} from "../tool-helpers.js";
import {
  insertClauseAtEndOfFunction,
  renderSimpleDiff,
} from "./shared.js";

export function registerEditTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_triage_error",
    description: "Classify a raw Agda error into mechanical/proof/toolchain categories with confidence and a machine-readable suggested action.",
    category: "analysis",
    inputSchema: {
      error: z.string().describe("Raw compiler or MCP error text to classify"),
    },
    outputDataSchema: z.object({
      category: z.enum([
        "mechanical-import",
        "mechanical-rename",
        "parser-regression",
        "coverage-missing",
        "proof-obligation",
        "dep-failure",
        "toolchain",
      ]),
      confidence: z.number().min(0).max(1),
      suggestedAction: z.record(z.string(), z.unknown()),
      suggestedRename: z.string().optional(),
    }),
    callback: async ({ error }: { error: string }) => {
      const triage = classifyAgdaError(error);
      return makeToolResult(
        okEnvelope({
          tool: "agda_triage_error",
          summary: `${triage.category} (${triage.confidence})`,
          classification: triage.category,
          data: {
            category: triage.category,
            confidence: triage.confidence,
            suggestedAction: triage.suggestedAction as unknown as Record<string, unknown>,
            suggestedRename: triage.suggestedRename,
          },
        }),
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_apply_rename",
    description: "Apply a scoped textual rename inside one Agda file, optionally re-load it, and return the resulting textual diff.",
    category: "navigation",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      from: z.string().describe("Name to rename"),
      to: z.string().describe("Replacement name"),
      dryRun: z.boolean().optional().describe("When true, compute diff only and do not write the file"),
    },
    outputDataSchema: z.object({
      file: z.string(),
      replacements: z.number(),
      changed: z.boolean(),
      diff: z.string(),
      loadClassification: z.string().nullable(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
    callback: async ({ file, from, to, dryRun }: { file: string; from: string; to: string; dryRun?: boolean }) => {
      let requested: string;
      try {
        requested = resolveFileWithinRoot(repoRoot, file);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_apply_rename",
              summary: `Invalid path: ${file}`,
              classification: "invalid-path",
              data: {
                file,
                replacements: 0,
                changed: false,
                diff: "",
                loadClassification: null,
                errors: [`Invalid file path: ${file}`],
                warnings: [],
              },
              diagnostics: [errorDiagnostic(
                `Invalid file path: ${file}`,
                "invalid-path",
                "The path resolved outside PROJECT_ROOT. Pass a relative path or an absolute path inside the project root.",
              )],
            }),
          );
        }
        throw err;
      }
      if (!existsSync(requested)) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_apply_rename",
            summary: `File not found: ${file}`,
            classification: "not-found",
            data: {
              file,
              replacements: 0,
              changed: false,
              diff: "",
              loadClassification: null,
              errors: [`File not found: ${file}`],
              warnings: [],
            },
            diagnostics: [errorDiagnostic(
              `File not found: ${file}`,
              "not-found",
              "Confirm the path is relative to PROJECT_ROOT and the file exists. Use `agda_file_list` or `agda_search` to discover available files.",
            )],
          }),
        );
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requested);
      const before = readFileSync(filePath, "utf8");
      const renamed = applyScopedRename(before, from, to);
      const relPath = relative(repoRoot, filePath);
      const diff = renderSimpleDiff(before, renamed.updated, relPath);

      let loadClassification: string | null = null;
      let errors: string[] = [];
      let warnings: string[] = [];
      let configWarningDiags: ToolDiagnostic[] = [];
      if (!dryRun && renamed.replacements > 0) {
        writeFileSync(filePath, renamed.updated, "utf8");
        const load = await session.load(filePath);
        loadClassification = load.classification;
        errors = load.errors.map(rewriteCompilerPlaceholders);
        warnings = load.warnings.map(rewriteCompilerPlaceholders);
        configWarningDiags = projectConfigDiagnostics(load.projectConfigWarnings);
      }

      const changed = renamed.replacements > 0;
      return makeToolResult(
        okEnvelope({
          tool: "agda_apply_rename",
          summary: changed
            ? `Applied ${renamed.replacements} rename(s) in ${relPath}.`
            : `No occurrences of ${from} found in ${relPath}.`,
          classification: changed ? "ok" : "no-op",
          data: {
            file: relPath,
            replacements: renamed.replacements,
            changed,
            diff,
            loadClassification,
            errors,
            warnings,
          },
          diagnostics: configWarningDiags.length > 0 ? configWarningDiags : undefined,
        }),
        diff.length > 0 ? `\`\`\`diff\n${diff}\n\`\`\`` : "No changes.",
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_add_missing_clauses",
    description: "Generate and optionally insert a missing-clause stub for a function with coverage errors.",
    category: "proof",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      functionName: z.string().describe("Function name with missing coverage clauses"),
      writeToFile: z.boolean().optional().describe("Write the generated clause into the source file (default true)"),
    },
    outputDataSchema: z.object({
      file: z.string(),
      functionName: z.string(),
      insertedClause: z.string(),
      arity: z.number(),
      loadClassification: z.string().nullable(),
    }),
    callback: async ({ file, functionName, writeToFile }: { file: string; functionName: string; writeToFile?: boolean }) => {
      const filePath = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, file));
      const source = readFileSync(filePath, "utf8");
      const arity = inferMissingClauseArity(source, functionName);
      const clause = buildMissingClause(functionName, arity);
      let loadClassification: string | null = null;
      let configWarningDiags: ToolDiagnostic[] = [];
      const shouldWrite = writeToFile !== false;
      if (shouldWrite) {
        const next = insertClauseAtEndOfFunction(source, functionName, clause);
        writeFileSync(filePath, next, "utf8");
        const load = await session.load(filePath);
        loadClassification = load.classification;
        configWarningDiags = projectConfigDiagnostics(load.projectConfigWarnings);
      }
      return makeToolResult(
        okEnvelope({
          tool: "agda_add_missing_clauses",
          summary: `Generated missing clause stub for ${functionName}: ${clause}`,
          data: {
            file: relative(repoRoot, filePath),
            functionName,
            insertedClause: clause,
            arity,
            loadClassification,
          },
          diagnostics: configWarningDiags.length > 0 ? configWarningDiags : undefined,
        }),
        `\`\`\`agda\n${clause}\n\`\`\``,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_infer_fixity_conflicts",
    description: "Detect user-defined operators missing fixity declarations that likely bind unexpectedly against imported operators.",
    category: "analysis",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      applyFixity: z.boolean().optional().describe("When true, insert suggested fixity declarations at the top of the file"),
    },
    outputDataSchema: z.object({
      file: z.string(),
      conflicts: z.array(z.object({
        operator: z.string(),
        line: z.number(),
        conflictingOperator: z.string(),
        conflictingPrecedence: z.number(),
        suggestedFixity: z.string(),
      })),
      appliedFixities: z.array(z.string()),
    }),
    callback: async ({ file, applyFixity }: { file: string; applyFixity?: boolean }) => {
      const filePath = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, file));
      const source = readFileSync(filePath, "utf8");
      const conflicts = inferFixityConflicts(source);
      const appliedFixities: string[] = [];
      if (applyFixity && conflicts.length > 0) {
        const existing = new Set(source.split(/\r?\n/u).map((line) => line.trim()));
        const lines = source.split(/\r?\n/u);
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*module\b/u.test(lines[i])) {
            insertAt = i + 1;
            break;
          }
        }
        const uniqueFixities = [...new Set(conflicts.map((conflict) => conflict.suggestedFixity))];
        const toInsert = uniqueFixities.filter((fixity) => !existing.has(fixity));
        if (toInsert.length > 0) {
          lines.splice(insertAt, 0, ...toInsert);
          writeFileSync(filePath, lines.join("\n"), "utf8");
          appliedFixities.push(...toInsert);
        }
      }
      const text = conflicts.length === 0
        ? "No likely fixity conflicts found."
        : conflicts.map((conflict) => `- line ${conflict.line}: ${conflict.operator} vs ${conflict.conflictingOperator}; suggest \`${conflict.suggestedFixity}\``).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_infer_fixity_conflicts",
          summary: conflicts.length === 0
            ? "No likely fixity conflicts."
            : `Found ${conflicts.length} likely fixity conflict(s).`,
          classification: conflicts.length === 0 ? "ok" : "warning",
          data: {
            file: relative(repoRoot, filePath),
            conflicts,
            appliedFixities,
          },
          diagnostics: conflicts.map((conflict) =>
            warningDiagnostic(
              `Likely fixity conflict at line ${conflict.line}: ${conflict.operator} may bind tighter than ${conflict.conflictingOperator}.`,
              "fixity-conflict",
            )),
        }),
        text,
      );
    },
  });
}
