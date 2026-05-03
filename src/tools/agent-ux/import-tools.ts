// MIT License — see LICENSE
//
// Import-resolution tools: locate where a name is defined, and resolve
// clashes when the same name is in scope from multiple imports.
//
// Shares `parseModuleSourceShape` + `parseTopLevelDefinitions` with the
// rename tools but is split out because the import-graph traversal in
// `agda_find_clash_source` makes this category meaningfully distinct
// from "edit one file" refactors.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import {
  parseModuleSourceShape,
  parseTopLevelDefinitions,
} from "../../agda/agent-ux.js";
import { buildImportGraph } from "../../agda/import-graph.js";
import { filePathDescription } from "../../agda/version-support.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../../repo-root.js";
import {
  errorDiagnostic,
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "../tool-helpers.js";
import {
  collectImportCandidates,
  scoreImportCandidate,
} from "./shared.js";

export function registerImportTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_suggest_import",
    description: "Suggest `open import` candidates for a missing symbol by reverse-indexing symbol definitions across the repository.",
    category: "navigation",
    inputSchema: {
      symbol: z.string().describe("Unresolved symbol to locate"),
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      maxCandidates: z.number().int().min(1).max(50).optional(),
    },
    outputDataSchema: z.object({
      symbol: z.string(),
      candidates: z.array(z.object({
        module: z.string(),
        file: z.string(),
        line: z.number(),
        score: z.number(),
        importLine: z.string(),
      })),
    }),
    callback: async ({ symbol, file, maxCandidates }: { symbol: string; file: string; maxCandidates?: number }) => {
      let requestedPath: string;
      try {
        requestedPath = resolveFileWithinRoot(repoRoot, file);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_suggest_import",
              summary: `Invalid file path: ${file}`,
              classification: "invalid-path",
              data: { symbol, candidates: [] },
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
      if (!existsSync(requestedPath)) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_suggest_import",
            summary: `File not found: ${file}`,
            classification: "not-found",
            data: { symbol, candidates: [] },
            diagnostics: [errorDiagnostic(
              `File not found: ${file}`,
              "not-found",
              "Confirm the path is relative to PROJECT_ROOT and the file exists. Use `agda_file_list` or `agda_search` to discover available files.",
            )],
          }),
        );
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedPath);
      const source = readFileSync(filePath, "utf8");
      const shape = parseModuleSourceShape(source);
      const existingImports = new Set(shape.imports.map((imp) => imp.moduleName));

      const raw = collectImportCandidates(repoRoot, symbol);
      const ranked = raw
        .map((entry) => ({
          module: entry.moduleName,
          file: entry.file,
          line: entry.line,
          score: scoreImportCandidate(existingImports, entry.moduleName),
          importLine: `open import ${entry.moduleName}`,
        }))
        .sort((a, b) => b.score - a.score || a.module.localeCompare(b.module));
      const limited = ranked.slice(0, maxCandidates ?? 10);
      const text = limited.length === 0
        ? `No import candidates found for \`${symbol}\`.`
        : limited.map((entry) => `- ${entry.importLine}  # ${entry.file}:${entry.line}`).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_suggest_import",
          summary: `Found ${limited.length} candidate import(s) for ${symbol}.`,
          classification: limited.length > 0 ? "ok" : "no-results",
          data: { symbol, candidates: limited },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_find_clash_source",
    description: "Given a symbol and file, identify local and imported binding sites and the likely `open import` introducing the clash.",
    category: "analysis",
    inputSchema: {
      symbol: z.string().describe("Conflicting symbol name"),
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
    },
    outputDataSchema: z.object({
      symbol: z.string(),
      localBindings: z.array(z.object({ line: z.number(), typeSignature: z.boolean() })),
      importedBindings: z.array(z.object({ module: z.string(), file: z.string(), line: z.number(), importLine: z.number().nullable() })),
      clashSource: z.object({ module: z.string(), importLine: z.number().nullable() }).nullable(),
    }),
    callback: async ({ symbol, file }: { symbol: string; file: string }) => {
      let requestedPath: string;
      try {
        requestedPath = resolveFileWithinRoot(repoRoot, file);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_find_clash_source",
              summary: `Invalid file path: ${file}`,
              classification: "invalid-path",
              data: {
                symbol,
                localBindings: [],
                importedBindings: [],
                clashSource: null,
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
      if (!existsSync(requestedPath)) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_find_clash_source",
            summary: `File not found: ${file}`,
            classification: "not-found",
            data: {
              symbol,
              localBindings: [],
              importedBindings: [],
              clashSource: null,
            },
            diagnostics: [errorDiagnostic(
              `File not found: ${file}`,
              "not-found",
              "Confirm the path is relative to PROJECT_ROOT and the file exists. Use `agda_file_list` or `agda_search` to discover available files.",
            )],
          }),
        );
      }
      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedPath);
      const source = readFileSync(filePath, "utf8");
      const shape = parseModuleSourceShape(source);
      const defs = parseTopLevelDefinitions(source);
      const localBindings = defs
        .filter((def) => def.name === symbol)
        .map((def) => ({ line: def.line, typeSignature: def.typeSignature }));

      const graph = buildImportGraph(repoRoot, session.getAgdaVersion() ?? undefined);
      const importedBindings: Array<{ module: string; file: string; line: number; importLine: number | null }> = [];
      for (const imp of shape.imports) {
        const relImported = graph.moduleNameToFile.get(imp.moduleName);
        if (!relImported) continue;
        const absImported = resolve(repoRoot, relImported);
        if (!existsSync(absImported)) continue;
        // Per-file try/catch so one unreadable import (permissions /
        // deleted between the existsSync check and the read) doesn't
        // abort the whole clash-source search. The overall tool would
        // still produce a result envelope via the registerStructuredTool
        // safety net, but skip-and-continue gives the agent a useful
        // partial answer for the imports that DID succeed.
        let importedSource: string;
        try {
          importedSource = readFileSync(absImported, "utf8");
        } catch {
          continue;
        }
        const importedDefs = parseTopLevelDefinitions(importedSource);
        for (const def of importedDefs) {
          if (def.name !== symbol) continue;
          importedBindings.push({
            module: imp.moduleName,
            file: relImported,
            line: def.line,
            importLine: imp.line,
          });
        }
      }

      const clashSource = importedBindings.length > 0 && importedBindings[0].importLine != null
        ? { module: importedBindings[0].module, importLine: importedBindings[0].importLine }
        : importedBindings.length > 0
          ? { module: importedBindings[0].module, importLine: null }
          : null;
      const textParts: string[] = [];
      textParts.push(`## Clash source for \`${symbol}\``);
      textParts.push("");
      if (localBindings.length > 0) {
        textParts.push("### Local bindings");
        for (const binding of localBindings) {
          textParts.push(`- line ${binding.line}${binding.typeSignature ? " (signature)" : " (equation)"}`);
        }
      } else {
        textParts.push("No local binding for this symbol was found.");
      }
      textParts.push("");
      if (importedBindings.length > 0) {
        textParts.push("### Imported bindings");
        for (const binding of importedBindings) {
          textParts.push(`- ${binding.module} (${binding.file}:${binding.line}) via import line ${binding.importLine ?? "?"}`);
        }
      } else {
        textParts.push("No imported binding site was found for this symbol.");
      }
      return makeToolResult(
        okEnvelope({
          tool: "agda_find_clash_source",
          summary: clashSource
            ? clashSource.importLine != null
              ? `Likely clash source: open import ${clashSource.module} (line ${clashSource.importLine}).`
              : `Likely clash source: open import ${clashSource.module} (import line unknown).`
            : `No imported clash source found for ${symbol}.`,
          classification: clashSource ? "ok" : "no-results",
          data: {
            symbol,
            localBindings,
            importedBindings,
            clashSource,
          },
        }),
        textParts.join("\n"),
      );
    },
  });
}
