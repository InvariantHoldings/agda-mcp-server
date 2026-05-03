// MIT License — see LICENSE
//
// Agent UX tools from docs/bug-reports/agent-ux-observations.md.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../agda-process.js";
import {
  applyScopedRename,
  buildMissingClause,
  classifyAgdaError,
  extractPostulateSites,
  inferFixityConflicts,
  inferMissingClauseArity,
  parseAgdaLibFlags,
  parseModuleSourceShape,
  parseOptionsPragmas,
  parseTopLevelDefinitions,
  rewriteCompilerPlaceholders,
  type TriageClass,
} from "../agda/agent-ux.js";
import { buildImportGraph, computeImpact } from "../agda/import-graph.js";
import { createLibraryRegistration } from "../agda/library-registration.js";
import { filePathDescription, isAgdaSourceFile } from "../agda/version-support.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import {
  ENV_DEFAULT_FLAGS,
  PROJECT_CONFIG_FILENAME,
  loadProjectConfig,
} from "../session/project-config.js";
import {
  errorDiagnostic,
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "./tool-helpers.js";

interface StdlibMigrationEntry {
  fromVersion: string;
  toVersion: string;
  from: string;
  to: string;
}

interface BuiltinMigrationEntry {
  name: string;
  module: string;
  renamedFrom?: string;
  removedIn?: string;
  replacement?: string;
}

const STDLIB_MIGRATION_MAP: ReadonlyArray<StdlibMigrationEntry> = [
  { fromVersion: "1.7", toVersion: "2.0", from: "proj1", to: "proj₁" },
  { fromVersion: "1.7", toVersion: "2.0", from: "proj2", to: "proj₂" },
  { fromVersion: "1.7", toVersion: "2.0", from: "_,_", to: "_,_" },
  { fromVersion: "2.0", toVersion: "2.1", from: "Data.Nat.Properties.≤-refl", to: "Data.Nat.Properties.≤-refl" },
];

const BUILTIN_MIGRATION_MAP: ReadonlyArray<BuiltinMigrationEntry> = [
  { name: "Nat", module: "Agda.Builtin.Nat" },
  { name: "List", module: "Agda.Builtin.List" },
  { name: "Bool", module: "Agda.Builtin.Bool" },
  { name: "Sigma", module: "Agda.Builtin.Sigma", renamedFrom: "Σ" },
  { name: "IO", module: "Agda.Builtin.IO" },
  { name: "Word64", module: "Agda.Builtin.Word", removedIn: "2.9.0", replacement: "Data.Word.Word64" },
];

function walkAgdaFiles(root: string, agdaVersion = undefined as unknown): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_build" || entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        walk(abs);
        continue;
      }
      if (entry.isFile() && isAgdaSourceFile(entry.name, agdaVersion as any)) {
        files.push(abs);
      }
    }
  }

  walk(root);
  files.sort();
  return files;
}

function renderSimpleDiff(before: string, after: string, relPath: string): string {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  const max = Math.max(beforeLines.length, afterLines.length);
  const out: string[] = [];
  out.push(`--- ${relPath}`);
  out.push(`+++ ${relPath}`);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i] ?? "";
    const a = afterLines[i] ?? "";
    if (b === a) continue;
    out.push(`- ${b}`);
    out.push(`+ ${a}`);
  }
  return out.join("\n");
}

function relativeOrIdentity(root: string, path: string): string {
  try {
    return relative(root, path);
  } catch {
    return path;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// All supported Agda source extensions including all literate variants.
// The union covers: .agda, .lagda, .lagda.tex, .lagda.md, .lagda.rst,
// .lagda.org, .lagda.tree, .lagda.typ
const AGDA_SOURCE_SUFFIX_RE = /\.(?:agda|lagda(?:\.(?:md|rst|tex|org|typ|tree))?)$/iu;
const AGDA_SOURCE_PATH_RE = /([A-Za-z0-9_./-]+\.(?:agda|lagda(?:\.(?:md|rst|tex|org|typ|tree))?))/iu;

function extractPathFromDiagnostic(message: string): string | null {
  const rewritten = rewriteCompilerPlaceholders(message);
  const match = AGDA_SOURCE_PATH_RE.exec(rewritten);
  return match?.[1] ?? null;
}

function moduleNameFromPath(relPath: string): string {
  return relPath
    .replace(AGDA_SOURCE_SUFFIX_RE, "")
    .replaceAll("\\", "/")
    .replace(/\//g, ".")
    .replace(/^agda\./, "");
}

function classifyBulkStatus(result: { success: boolean; classification: string; hasHoles: boolean }): "clean" | "holes" | "error" {
  if (!result.success || result.classification === "type-error") return "error";
  if (result.hasHoles || result.classification === "ok-with-holes") return "holes";
  return "clean";
}

function insertClauseAtEndOfFunction(source: string, functionName: string, clause: string): string {
  const lines = source.split(/\r?\n/u);
  const fnRe = new RegExp(`^\\s*${escapeRegex(functionName)}\\b`, "u");
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fnRe.test(lines[i])) {
      lastIdx = i;
    }
  }
  const insertAt = lastIdx >= 0 ? lastIdx + 1 : lines.length;
  lines.splice(insertAt, 0, clause);
  return lines.join("\n");
}

function collectImportCandidates(repoRoot: string, symbol: string): Array<{ moduleName: string; file: string; line: number }> {
  const files = walkAgdaFiles(resolve(repoRoot, "agda"));
  const out: Array<{ moduleName: string; file: string; line: number }> = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const shape = parseModuleSourceShape(source);
    const moduleName = shape.moduleName ?? moduleNameFromPath(relative(repoRoot, file));
    for (const def of parseTopLevelDefinitions(source)) {
      if (def.name === symbol) {
        out.push({ moduleName, file: relative(repoRoot, file), line: def.line });
      }
    }
  }
  return out;
}

function scoreImportCandidate(existingImports: Set<string>, moduleName: string): number {
  const head = moduleName.split(".")[0] ?? "";
  let score = 0;
  for (const existing of existingImports) {
    if (existing === moduleName) score += 100;
    if (existing.split(".")[0] === head) score += 5;
  }
  score -= moduleName.split(".").length;
  return score;
}

function computeSubdirectoryLabel(baseDir: string, relFile: string): string {
  const relToDir = relative(baseDir, relFile).replaceAll("\\", "/");
  const segments = relToDir.split("/").filter((s) => s.length > 0);
  // File is directly under baseDir (no subdirectory) — use stable root bucket label
  if (segments.length < 2) return ".";
  return segments[0] ?? ".";
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_stdlib_migration_map",
    description: "Return the curated stdlib rename map keyed by source and target versions. Use this before applying mechanical rename repairs.",
    category: "reporting",
    inputSchema: {
      fromVersion: z.string().optional().describe("Optional source stdlib version filter"),
      toVersion: z.string().optional().describe("Optional destination stdlib version filter"),
      symbol: z.string().optional().describe("Optional symbol filter (matches either source or destination name)"),
    },
    outputDataSchema: z.object({
      entries: z.array(z.object({
        fromVersion: z.string(),
        toVersion: z.string(),
        from: z.string(),
        to: z.string(),
      })),
      count: z.number(),
    }),
    callback: async ({ fromVersion, toVersion, symbol }: { fromVersion?: string; toVersion?: string; symbol?: string }) => {
      const filtered = STDLIB_MIGRATION_MAP.filter((entry) => {
        if (fromVersion && entry.fromVersion !== fromVersion) return false;
        if (toVersion && entry.toVersion !== toVersion) return false;
        if (symbol && !(entry.from.includes(symbol) || entry.to.includes(symbol))) return false;
        return true;
      });
      const text = filtered.length === 0
        ? "No stdlib migration entries matched the filter."
        : filtered.map((entry) => `- ${entry.fromVersion} → ${entry.toVersion}: \`${entry.from}\` → \`${entry.to}\``).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_stdlib_migration_map",
          summary: `Found ${filtered.length} stdlib migration entr${filtered.length === 1 ? "y" : "ies"}.`,
          data: { entries: filtered, count: filtered.length },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_builtin_migration_map",
    description: "Return curated builtin rename/removal records across Agda versions.",
    category: "reporting",
    inputSchema: {
      name: z.string().optional().describe("Optional builtin name filter"),
    },
    outputDataSchema: z.object({
      entries: z.array(z.object({
        name: z.string(),
        module: z.string(),
        renamedFrom: z.string().optional(),
        removedIn: z.string().optional(),
        replacement: z.string().optional(),
      })),
      count: z.number(),
    }),
    callback: async ({ name }: { name?: string }) => {
      const filtered = name
        ? BUILTIN_MIGRATION_MAP.filter((entry) => entry.name === name || entry.renamedFrom === name)
        : [...BUILTIN_MIGRATION_MAP];
      const text = filtered.length === 0
        ? "No builtin migration records matched the filter."
        : filtered
          .map((entry) => {
            const details: string[] = [];
            if (entry.renamedFrom) details.push(`renamed from ${entry.renamedFrom}`);
            if (entry.removedIn) details.push(`removed in ${entry.removedIn}`);
            if (entry.replacement) details.push(`replacement ${entry.replacement}`);
            return `- ${entry.name} (${entry.module})${details.length > 0 ? ` — ${details.join(", ")}` : ""}`;
          })
          .join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_builtin_migration_map",
          summary: `Found ${filtered.length} builtin migration entr${filtered.length === 1 ? "y" : "ies"}.`,
          data: { entries: filtered, count: filtered.length },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_verify_builtin",
    description: "Given a builtin name, report whether it is resolvable from the curated builtin map and provide migration hints.",
    category: "analysis",
    inputSchema: {
      name: z.string().describe("Builtin name, e.g. Nat, Sigma, IO"),
      options: z.object({
        agdaVersion: z.string().optional(),
      }).optional(),
    },
    outputDataSchema: z.object({
      name: z.string(),
      resolvable: z.boolean(),
      module: z.string().nullable(),
      hints: z.array(z.string()),
    }),
    callback: async ({ name }: { name: string }) => {
      const match = BUILTIN_MIGRATION_MAP.find((entry) => entry.name === name || entry.renamedFrom === name);
      const hints: string[] = [];
      if (match?.renamedFrom && match.renamedFrom === name) {
        hints.push(`Renamed builtin: use ${match.name}`);
      }
      if (match?.removedIn && match.replacement) {
        hints.push(`Builtin removed in ${match.removedIn}; use ${match.replacement}`);
      }
      if (!match) {
        hints.push("No curated builtin match; verify with Agda version docs.");
      }
      return makeToolResult(
        okEnvelope({
          tool: "agda_verify_builtin",
          summary: match ? `${name} resolves via ${match.module}.` : `${name} was not found in the curated builtin map.`,
          classification: match ? "ok" : "unknown-builtin",
          data: {
            name,
            resolvable: Boolean(match && !match.removedIn),
            module: match?.module ?? null,
            hints,
          },
          diagnostics: hints.map((hint) => warningDiagnostic(hint, "builtin-migration")),
        }),
      );
    },
  });

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
              diagnostics: [errorDiagnostic(`Invalid file path: ${file}`, "invalid-path")],
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
            diagnostics: [errorDiagnostic(`File not found: ${file}`, "not-found")],
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
      if (!dryRun && renamed.replacements > 0) {
        writeFileSync(filePath, renamed.updated, "utf8");
        const load = await session.load(filePath);
        loadClassification = load.classification;
        errors = load.errors.map(rewriteCompilerPlaceholders);
        warnings = load.warnings.map(rewriteCompilerPlaceholders);
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
        }),
        diff.length > 0 ? `\`\`\`diff\n${diff}\n\`\`\`` : "No changes.",
      );
    },
  });

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
              diagnostics: [errorDiagnostic(`Invalid file path: ${file}`, "invalid-path")],
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
            diagnostics: [errorDiagnostic(`File not found: ${file}`, "not-found")],
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
              diagnostics: [errorDiagnostic(`Invalid file path: ${file}`, "invalid-path")],
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
            diagnostics: [errorDiagnostic(`File not found: ${file}`, "not-found")],
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
        const importedDefs = parseTopLevelDefinitions(readFileSync(absImported, "utf8"));
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
      const shouldWrite = writeToFile !== false;
      if (shouldWrite) {
        const next = insertClauseAtEndOfFunction(source, functionName, clause);
        writeFileSync(filePath, next, "utf8");
        const load = await session.load(filePath);
        loadClassification = load.classification;
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

  registerStructuredTool({
    server,
    name: "agda_effective_options",
    description: "Return effective Agda options for a file with source attribution (OPTIONS pragma, .agda-lib flags, wrapper hints, and MCP defaults).",
    category: "analysis",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
    },
    outputDataSchema: z.object({
      file: z.string(),
      options: z.array(z.object({
        option: z.string(),
        source: z.enum(["file-pragma", "agda-lib", "wrapper-script", "mcp-default", "project-config", "env-var"]),
      })),
      deduplicated: z.array(z.string()),
    }),
    callback: async ({ file }: { file: string }) => {
      const filePath = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, file));
      const source = readFileSync(filePath, "utf8");
      const options: Array<{ option: string; source: "file-pragma" | "agda-lib" | "wrapper-script" | "mcp-default" | "project-config" | "env-var" }> = [];
      for (const opt of parseOptionsPragmas(source)) {
        options.push({ option: opt, source: "file-pragma" });
      }

      const repoEntries = readdirSync(repoRoot, { withFileTypes: true });
      for (const entry of repoEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".agda-lib")) continue;
        const libText = readFileSync(resolve(repoRoot, entry.name), "utf8");
        for (const flag of parseAgdaLibFlags(libText)) {
          options.push({ option: flag, source: "agda-lib" });
        }
      }

      // Report project config file flags and env var flags separately.
      // Sources are pre-partitioned by `loadProjectConfig`, so a flag
      // present in BOTH `.agda-mcp.json` and AGDA_MCP_DEFAULT_FLAGS shows
      // up once per source rather than being misattributed.
      const projectConfig = loadProjectConfig(repoRoot);
      for (const opt of projectConfig.fileFlags) {
        options.push({ option: opt, source: "project-config" });
      }
      for (const opt of projectConfig.envFlags) {
        options.push({ option: opt, source: "env-var" });
      }

      const agdaBin = process.env.AGDA_BIN;
      if (agdaBin && existsSync(agdaBin)) {
        const scriptText = readFileSync(agdaBin, "utf8");
        const discovered = scriptText.match(/--[A-Za-z0-9-]+/gu) ?? [];
        for (const flag of discovered) {
          options.push({ option: flag, source: "wrapper-script" });
        }
      }

      options.push({ option: "--interaction-json", source: "mcp-default" });
      const registration = createLibraryRegistration(repoRoot);
      try {
        for (const opt of registration.agdaArgs) {
          options.push({ option: opt, source: "mcp-default" });
        }
      } finally {
        registration.cleanup();
      }

      const deduplicated = [...new Set(options.map((entry) => entry.option))];
      const text = options.map((entry) => `- ${entry.option} (${entry.source})`).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_effective_options",
          summary: `Resolved ${deduplicated.length} effective option(s).`,
          data: {
            file: relative(repoRoot, filePath),
            options,
            deduplicated,
          },
        }),
        text,
      );
    },
  });

  // agda_project_config — diagnose `.agda-mcp.json` and AGDA_MCP_DEFAULT_FLAGS
  // without forcing a load. When a load fails because of a typoed key or
  // flag, the warnings on the load response already explain why; this
  // tool lets an agent inspect the resolved config in isolation.
  registerStructuredTool({
    server,
    name: "agda_project_config",
    description:
      "Inspect the resolved project-level Agda configuration (.agda-mcp.json + AGDA_MCP_DEFAULT_FLAGS) " +
      "with provenance and validation warnings. Use this when an agent wants to confirm which compiler " +
      "flags will be applied to subsequent agda_load / agda_typecheck calls before running them.",
    category: "analysis",
    inputSchema: {},
    outputDataSchema: z.object({
      configFilePath: z.string().nullable(),
      configFileExists: z.boolean(),
      envVarName: z.string(),
      envVarSet: z.boolean(),
      fileFlags: z.array(z.string()),
      envFlags: z.array(z.string()),
      effectiveFlags: z.array(z.string()),
      warnings: z.array(z.object({
        source: z.enum(["file", "env", "system"]),
        message: z.string(),
        path: z.string().optional(),
      })),
    }),
    callback: async () => {
      const projectConfig = loadProjectConfig(repoRoot);
      const configFilePath = projectConfig.configFilePath ?? null;
      const configFileExists = configFilePath !== null && existsSync(configFilePath);
      const envVarRaw = process.env[ENV_DEFAULT_FLAGS];
      // `envVarSet` should mirror the *effective* state, so a value of
      // "   " or "\t\n" — which `parseEnvFlags()` resolves to zero
      // flags — is reported as unset. Otherwise an agent inspecting the
      // config sees `envVarSet: true` while `envFlags` is empty, which
      // looks contradictory.
      const envVarSet = envVarRaw !== undefined && envVarRaw.trim().length > 0;

      // Effective flags = file flags then env flags, deduplicated by
      // last-wins (so `agda_project_config` reports the same final list a
      // load with no per-call options would build). Per-call options live
      // on the tool call itself and aren't visible at config time.
      const seen = new Set<string>();
      const effectiveFlags: string[] = [];
      const allFlags = [...projectConfig.fileFlags, ...projectConfig.envFlags];
      for (let i = allFlags.length - 1; i >= 0; i--) {
        const flag = allFlags[i];
        if (!seen.has(flag)) {
          seen.add(flag);
          effectiveFlags.unshift(flag);
        }
      }

      const data = {
        configFilePath: configFilePath ? relative(repoRoot, configFilePath) : null,
        configFileExists,
        envVarName: ENV_DEFAULT_FLAGS,
        envVarSet,
        fileFlags: projectConfig.fileFlags,
        envFlags: projectConfig.envFlags,
        effectiveFlags,
        warnings: projectConfig.warnings,
      };

      const lines: string[] = [
        `${PROJECT_CONFIG_FILENAME}: ${
          configFileExists
            ? `present (${data.configFilePath})`
            : "not present"
        }`,
        `${ENV_DEFAULT_FLAGS}: ${envVarSet ? "set" : "unset"}`,
        projectConfig.fileFlags.length > 0
          ? `File flags: ${projectConfig.fileFlags.join(" ")}`
          : "File flags: (none)",
        projectConfig.envFlags.length > 0
          ? `Env flags: ${projectConfig.envFlags.join(" ")}`
          : "Env flags: (none)",
        effectiveFlags.length > 0
          ? `Effective flags (deduplicated): ${effectiveFlags.join(" ")}`
          : "Effective flags: (none)",
      ];
      if (projectConfig.warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const w of projectConfig.warnings) {
          lines.push(`- [${w.source}] ${w.message}`);
        }
      }

      const summary = projectConfig.warnings.length === 0
        ? `Resolved ${effectiveFlags.length} effective project flag(s).`
        : `Resolved ${effectiveFlags.length} effective project flag(s) with ${projectConfig.warnings.length} warning(s).`;

      return makeToolResult(
        okEnvelope({
          tool: "agda_project_config",
          summary,
          data,
          diagnostics: projectConfig.warnings.map((w) =>
            warningDiagnostic(
              `${w.source === "env" ? "env" : "config"}: ${w.message}`,
              `project-config-${w.source}`,
            ),
          ),
        }),
        lines.join("\n"),
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_postulate_closure",
    description: "Return transitive postulate dependencies for a file (optionally scoped to a symbol) grouped by subdirectory.",
    category: "analysis",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      symbol: z.string().optional().describe("Optional symbol label (currently informational)"),
    },
    outputDataSchema: z.object({
      file: z.string(),
      symbol: z.string().nullable(),
      postulates: z.array(z.object({
        file: z.string(),
        line: z.number(),
        declaration: z.string(),
      })),
      groupedBySubdirectory: z.array(z.object({
        subdirectory: z.string(),
        count: z.number(),
      })),
    }),
    callback: async ({ file, symbol }: { file: string; symbol?: string }) => {
      const filePath = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, file));
      const graph = buildImportGraph(repoRoot, session.getAgdaVersion() ?? undefined);
      const impact = computeImpact(graph, repoRoot, filePath);
      const deps = new Set<string>();
      if (impact) {
        for (const dep of impact.directDependencies) deps.add(dep);
        for (const dep of impact.transitiveDependencies) deps.add(dep);
      }
      deps.add(relative(repoRoot, filePath));
      if (deps.size <= 1) {
        const sourceShape = parseModuleSourceShape(readFileSync(filePath, "utf8"));
        for (const imp of sourceShape.imports) {
          const resolved = graph.moduleNameToFile.get(imp.moduleName);
          if (resolved) deps.add(resolved);
        }
      }

      const postulates: Array<{ file: string; line: number; declaration: string }> = [];
      for (const dep of deps) {
        const abs = resolve(repoRoot, dep);
        if (!existsSync(abs)) continue;
        const source = readFileSync(abs, "utf8");
        const sites = extractPostulateSites(source);
        for (const site of sites) {
          for (const declaration of site.declarations.length > 0 ? site.declarations : ["(anonymous)"]) {
            postulates.push({ file: dep, line: site.line, declaration });
          }
        }
      }

      const grouped = new Map<string, number>();
      for (const postulate of postulates) {
        const label = computeSubdirectoryLabel("agda", postulate.file);
        grouped.set(label, (grouped.get(label) ?? 0) + 1);
      }
      const groupedBySubdirectory = [...grouped.entries()]
        .map(([subdirectory, count]) => ({ subdirectory, count }))
        .sort((a, b) => b.count - a.count || a.subdirectory.localeCompare(b.subdirectory));

      const text = postulates.length === 0
        ? "No postulates in transitive dependency closure."
        : postulates.map((entry) => `- ${entry.file}:${entry.line} — ${entry.declaration}`).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_postulate_closure",
          summary: `Found ${postulates.length} transitive postulate declaration(s).`,
          classification: postulates.length > 0 ? "warning" : "ok",
          data: {
            file: relative(repoRoot, filePath),
            symbol: symbol ?? null,
            postulates,
            groupedBySubdirectory,
          },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_project_progress",
    description: "Project-wide static progress summary by subdirectory: total files, files with holes, files with postulates, and clean-by-scan counts.",
    category: "analysis",
    inputSchema: {
      directory: z.string().optional().describe("Directory under project root to scan (default: agda/)"),
    },
    outputDataSchema: z.object({
      directory: z.string(),
      totals: z.object({
        files: z.number(),
        clean: z.number(),
        withErrors: z.number(),
        withHoles: z.number(),
        withPostulates: z.number(),
      }),
      perSubdirectory: z.array(z.object({
        subdirectory: z.string(),
        files: z.number(),
        clean: z.number(),
        withErrors: z.number(),
        withHoles: z.number(),
        withPostulates: z.number(),
      })),
    }),
    callback: async ({ directory }: { directory?: string }) => {
      const requested = directory ?? "agda";
      const scanRoot = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, requested));
      const files = walkAgdaFiles(scanRoot, session.getAgdaVersion() ?? undefined);
      interface Bucket {
        files: number;
        clean: number;
        withErrors: number;
        withHoles: number;
        withPostulates: number;
      }
      const totals: Bucket = { files: 0, clean: 0, withErrors: 0, withHoles: 0, withPostulates: 0 };
      const bySubdir = new Map<string, Bucket>();

      for (const abs of files) {
        const rel = relative(repoRoot, abs);
        const source = readFileSync(abs, "utf8");
        const load = await session.loadNoMetas(abs);
        const hasErrors = !load.success || load.classification === "type-error";
        const holes = /\?(?!-|\})/u.test(source);
        const postulates = extractPostulateSites(source).length > 0;
        const clean = !holes && !postulates && !hasErrors;
        const label = computeSubdirectoryLabel(relative(repoRoot, scanRoot), rel);
        const bucket = bySubdir.get(label) ?? { files: 0, clean: 0, withErrors: 0, withHoles: 0, withPostulates: 0 };
        bucket.files += 1;
        if (clean) bucket.clean += 1;
        if (hasErrors) bucket.withErrors += 1;
        if (holes) bucket.withHoles += 1;
        if (postulates) bucket.withPostulates += 1;
        bySubdir.set(label, bucket);

        totals.files += 1;
        if (clean) totals.clean += 1;
        if (hasErrors) totals.withErrors += 1;
        if (holes) totals.withHoles += 1;
        if (postulates) totals.withPostulates += 1;
      }

      const perSubdirectory = [...bySubdir.entries()]
        .map(([subdirectory, bucket]) => ({ subdirectory, ...bucket }))
        .sort((a, b) => a.subdirectory.localeCompare(b.subdirectory));
      const text = [
        `Scanned ${totals.files} file(s) under ${relativeOrIdentity(repoRoot, scanRoot)}.`,
        `Clean: ${totals.clean}`,
        `With errors: ${totals.withErrors}`,
        `With holes: ${totals.withHoles}`,
        `With postulates: ${totals.withPostulates}`,
      ].join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_project_progress",
          summary: `Scanned ${totals.files} file(s): ${totals.clean} clean, ${totals.withErrors} with errors, ${totals.withHoles} with holes, ${totals.withPostulates} with postulates.`,
          data: {
            directory: relativeOrIdentity(repoRoot, scanRoot),
            totals,
            perSubdirectory,
          },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_bulk_status",
    description: "Run a multi-file status sweep and cluster failing files by likely root-cause file.",
    category: "analysis",
    inputSchema: {
      directory: z.string().optional().describe("Directory under project root to sweep (default: agda/)"),
      parallel: z.boolean().optional().describe("Attempt parallel sweep (best-effort; single-session mode still serializes protocol commands)"),
    },
    outputDataSchema: z.object({
      directory: z.string(),
      files: z.array(z.object({
        file: z.string(),
        status: z.enum(["clean", "holes", "error"]),
        classification: z.string(),
        rootCauseFile: z.string().nullable(),
        errorCount: z.number(),
        warningCount: z.number(),
      })),
      clusters: z.array(z.object({
        rootCauseFile: z.string(),
        files: z.array(z.string()),
      })),
    }),
    callback: async ({ directory, parallel }: { directory?: string; parallel?: boolean }) => {
      const requested = directory ?? "agda";
      const scanRoot = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, requested));
      const files = walkAgdaFiles(scanRoot, session.getAgdaVersion() ?? undefined);
      const graph = buildImportGraph(repoRoot, session.getAgdaVersion() ?? undefined);

      const statuses: Array<{
        file: string;
        status: "clean" | "holes" | "error";
        classification: string;
        rootCauseFile: string | null;
        errorCount: number;
        warningCount: number;
        errors: string[];
      }> = [];

      const classifyOne = async (abs: string) => {
        const load = await session.loadNoMetas(abs);
        const rel = relative(repoRoot, abs);
        statuses.push({
          file: rel,
          status: classifyBulkStatus(load),
          classification: load.classification,
          rootCauseFile: null,
          errorCount: load.errors.length,
          warningCount: load.warnings.length,
          errors: load.errors,
        });
      };

      if (parallel) {
        await Promise.all(files.map((abs) => classifyOne(abs)));
      } else {
        for (const abs of files) {
          await classifyOne(abs);
        }
      }
      statuses.sort((a, b) => a.file.localeCompare(b.file));

      const failedSet = new Set(statuses.filter((entry) => entry.status === "error").map((entry) => entry.file));
      for (const status of statuses) {
        if (status.status !== "error") continue;

        let root: string | null = null;
        for (const message of status.errors) {
          const pathFromDiag = extractPathFromDiagnostic(message);
          if (!pathFromDiag) continue;
          const abs = resolve(repoRoot, pathFromDiag);
          const rel = relative(repoRoot, abs);
          if (failedSet.has(rel)) {
            root = rel;
            break;
          }
        }

        if (!root) {
          const impact = computeImpact(graph, repoRoot, status.file);
          if (impact) {
            const failedDeps = impact.transitiveDependencies.filter((dep) => failedSet.has(dep));
            root = failedDeps.at(-1) ?? null;
          }
        }

        status.rootCauseFile = root ?? status.file;
      }

      const clustersMap = new Map<string, string[]>();
      for (const status of statuses) {
        // Only cluster files that failed — clean and holes files are not errors
        // and their inclusion skews the cluster view for agents consuming this data.
        if (status.status !== "error") continue;
        const root = status.rootCauseFile ?? status.file;
        const list = clustersMap.get(root) ?? [];
        list.push(status.file);
        clustersMap.set(root, list);
      }
      const clusters = [...clustersMap.entries()]
        .map(([rootCauseFile, groupedFiles]) => ({
          rootCauseFile,
          files: groupedFiles.sort(),
        }))
        .sort((a, b) => b.files.length - a.files.length || a.rootCauseFile.localeCompare(b.rootCauseFile));

      const text = [
        `Scanned ${statuses.length} file(s) under ${relativeOrIdentity(repoRoot, scanRoot)}.`,
        `Clean: ${statuses.filter((entry) => entry.status === "clean").length}`,
        `With holes: ${statuses.filter((entry) => entry.status === "holes").length}`,
        `Errors: ${statuses.filter((entry) => entry.status === "error").length}`,
      ].join("\n");

      return makeToolResult(
        okEnvelope({
          tool: "agda_bulk_status",
          summary: text,
          data: {
            directory: relativeOrIdentity(repoRoot, scanRoot),
            files: statuses.map(({ errors, ...rest }) => rest),
            clusters,
          },
        }),
        text,
      );
    },
  });

}
