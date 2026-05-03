// MIT License — see LICENSE
//
// Project-wide analysis tools: postulate closures, project progress
// summaries, and the bulk-status sweep with root-cause clustering.
// All three traverse the import graph and share the
// `walkAgdaFiles` + `computeSubdirectoryLabel` helpers.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import {
  extractPostulateSites,
  parseModuleSourceShape,
} from "../../agda/agent-ux.js";
import { buildImportGraph, computeImpact } from "../../agda/import-graph.js";
import { filePathDescription } from "../../agda/version-support.js";
import { resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../../repo-root.js";
import {
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "../tool-helpers.js";
import {
  classifyBulkStatus,
  computeSubdirectoryLabel,
  extractPathFromDiagnostic,
  relativeOrIdentity,
  walkAgdaFiles,
} from "./shared.js";

export function registerProjectTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
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
      // Files dropped from the sweep because of read failures or
      // subprocess errors. Empty on a healthy run; non-empty surfaces
      // partial-result transparency to an agent.
      skippedFiles: z.array(z.object({
        file: z.string(),
        reason: z.string(),
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
      // Files that vanished / became unreadable mid-sweep. Surfaced
      // in the response so an agent doesn't see "247 files" when the
      // real number was 250 with 3 silently dropped.
      const skippedFiles: Array<{ file: string; reason: string }> = [];

      for (const abs of files) {
        const rel = relative(repoRoot, abs);
        let source: string;
        try {
          source = readFileSync(abs, "utf8");
        } catch (err) {
          skippedFiles.push({
            file: rel,
            reason: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        let load: { success: boolean; classification: string };
        try {
          load = await session.loadNoMetas(abs);
        } catch (err) {
          // A subprocess crash on one file shouldn't abort the sweep;
          // record it as skipped and keep going.
          skippedFiles.push({
            file: rel,
            reason: `loadNoMetas threw: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
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
      const textLines = [
        `Scanned ${totals.files} file(s) under ${relativeOrIdentity(repoRoot, scanRoot)}.`,
        `Clean: ${totals.clean}`,
        `With errors: ${totals.withErrors}`,
        `With holes: ${totals.withHoles}`,
        `With postulates: ${totals.withPostulates}`,
      ];
      if (skippedFiles.length > 0) {
        textLines.push(`Skipped (read/load failed): ${skippedFiles.length}`);
      }
      const skippedSuffix = skippedFiles.length > 0
        ? ` (${skippedFiles.length} skipped)`
        : "";
      return makeToolResult(
        okEnvelope({
          tool: "agda_project_progress",
          summary:
            `Scanned ${totals.files} file(s): ${totals.clean} clean, ` +
            `${totals.withErrors} with errors, ${totals.withHoles} with holes, ` +
            `${totals.withPostulates} with postulates${skippedSuffix}.`,
          data: {
            directory: relativeOrIdentity(repoRoot, scanRoot),
            totals,
            perSubdirectory,
            skippedFiles,
          },
        }),
        textLines.join("\n"),
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
        const rel = relative(repoRoot, abs);
        try {
          const load = await session.loadNoMetas(abs);
          statuses.push({
            file: rel,
            status: classifyBulkStatus(load),
            classification: load.classification,
            rootCauseFile: null,
            errorCount: load.errors.length,
            warningCount: load.warnings.length,
            errors: load.errors,
          });
        } catch (err) {
          // Subprocess crash on this file — record as `error` with a
          // classification that an agent can recognize, so the rest of
          // the sweep continues. Without the catch, one wedged file
          // killed the whole tool call.
          statuses.push({
            file: rel,
            status: "error",
            classification: "process-error",
            rootCauseFile: null,
            errorCount: 1,
            warningCount: 0,
            errors: [`loadNoMetas threw: ${err instanceof Error ? err.message : String(err)}`],
          });
        }
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

      const cleanCount = statuses.filter((entry) => entry.status === "clean").length;
      const holesCount = statuses.filter((entry) => entry.status === "holes").length;
      const errorsCount = statuses.filter((entry) => entry.status === "error").length;
      const dirLabel = relativeOrIdentity(repoRoot, scanRoot);

      // 1-line summary is for agents that read the envelope by hand;
      // the multi-line text body adds the per-bucket breakdown that
      // would clutter the summary line.
      const summary =
        `Scanned ${statuses.length} file(s) under ${dirLabel}: ` +
        `${cleanCount} clean, ${holesCount} with holes, ${errorsCount} errors.`;
      const text = [
        `Scanned ${statuses.length} file(s) under ${dirLabel}.`,
        `Clean: ${cleanCount}`,
        `With holes: ${holesCount}`,
        `Errors: ${errorsCount}`,
      ].join("\n");

      return makeToolResult(
        okEnvelope({
          tool: "agda_bulk_status",
          summary,
          data: {
            directory: dirLabel,
            files: statuses.map(({ errors, ...rest }) => rest),
            clusters,
          },
        }),
        text,
      );
    },
  });
}
