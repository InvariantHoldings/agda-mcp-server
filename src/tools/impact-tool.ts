// MIT License — see LICENSE
//
// `agda_impact` — answer "which files transitively import this file?"
//
// Implements §2.3 of docs/bug-reports/agent-ux-observations.md. The
// agent UX bug report calls this out as the cheapest possible win
// for survey-scale work: when a single file's repair could unblock
// 30 downstream consumers, the agent should fix that file first
// instead of grinding through alphabetical order. The graph is
// purely filesystem-derived and shares no state with the AgdaSession
// — every call rebuilds the graph from scratch so a freshly added
// or moved file is picked up without a server restart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, realpathSync } from "node:fs";
import { relative } from "node:path";

import type { AgdaSession } from "../agda-process.js";
import { buildImportGraph, computeImpact } from "../agda/import-graph.js";
import { filePathDescription } from "../agda/version-support.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import {
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "./tool-helpers.js";

const impactDataSchema = z.object({
  file: z.string(),
  moduleName: z.string().nullable(),
  directDependents: z.array(z.string()),
  directDependentCount: z.number(),
  transitiveDependents: z.array(z.string()),
  transitiveDependentCount: z.number(),
  directDependencies: z.array(z.string()),
  directDependencyCount: z.number(),
  transitiveDependencies: z.array(z.string()),
  transitiveDependencyCount: z.number(),
  graphSize: z.number(),
});

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_impact",
    description: "Report the dependency impact of an Agda source file. Returns the direct + transitive sets in both directions: which files import this one (`dependents`) and which files this one imports (`dependencies`). Use this to pick the most-impactful upstream file to repair first when triaging a multi-file failure. Cheap to call repeatedly — the graph is rebuilt from disk each invocation, so newly added files show up without a server restart. Lists are sorted; pass `limit` to cap each list (default 50, hard cap 500).",
    category: "navigation",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
      limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional().describe(
        `Maximum number of entries to render in each of the four lists. Defaults to ${DEFAULT_LIST_LIMIT}; capped at ${MAX_LIST_LIMIT}. The structured-data fields always include the full lists regardless of this cap.`,
      ),
    },
    outputDataSchema: impactDataSchema,
    callback: async ({ file, limit }: { file: string; limit?: number }) => {
      let requestedFilePath: string;
      try {
        requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_impact",
              summary: `Invalid file path: ${file}`,
              classification: "invalid-path",
              data: emptyImpactData(file),
              diagnostics: [{ severity: "error", message: `Invalid file path: ${file}`, code: "invalid-path" }],
            }),
          );
        }
        throw err;
      }
      if (!existsSync(requestedFilePath)) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_impact",
            summary: `File not found: ${file}`,
            classification: "not-found",
            data: emptyImpactData(file),
            diagnostics: [{ severity: "error", message: `File not found: ${requestedFilePath}`, code: "not-found" }],
          }),
        );
      }

      let filePath: string;
      try {
        filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_impact",
              summary: `Invalid file path: ${file}`,
              classification: "invalid-path",
              data: emptyImpactData(file),
              diagnostics: [{ severity: "error", message: `Invalid file path: ${file}`, code: "invalid-path" }],
            }),
          );
        }
        throw err;
      }
      // Canonicalize the project root the same way `resolveExistingPathWithinRoot`
      // canonicalizes the source path, otherwise on macOS the graph
      // keys (built from `realpath(repoRoot)`) won't match the
      // `relative(repoRoot, filePath)` lookup because /var → /private/var.
      const canonicalRepoRoot = canonicalizeOrFallback(repoRoot);
      const graph = buildImportGraph(canonicalRepoRoot, session.getAgdaVersion() ?? undefined);
      const impact = computeImpact(graph, canonicalRepoRoot, filePath);

      if (impact === null) {
        // The file exists but isn't in the graph — usually because
        // it lives outside an Agda source extension or was filtered
        // out (e.g. inside _build). Report it as not-in-graph rather
        // than masking the situation.
        //
        // IMPORTANT: display paths are computed against the
        // canonicalized root (not `repoRoot`) because `filePath` is
        // realpath'd via `resolveExistingPathWithinRoot`. Mixing a
        // symlinked `repoRoot` with a realpath'd `filePath` in
        // `relative()` yields garbage `../private/...` output on
        // macOS — `agda_list_modules` has the same convention and a
        // symlink regression test guarding it.
        const notInGraphRel = relative(canonicalRepoRoot, filePath);
        return makeToolResult(
          errorEnvelope({
            tool: "agda_impact",
            summary: `File is not part of the Agda import graph: ${notInGraphRel}`,
            classification: "not-in-graph",
            data: emptyImpactData(notInGraphRel),
            diagnostics: [{
              severity: "error",
              message: `File exists but is not part of the scanned Agda import graph for ${notInGraphRel}; it may have been filtered out, may not be a recognized Agda source file, or no module declaration was parsed.`,
              code: "not-in-graph",
            }],
          }),
        );
      }

      const effectiveLimit = limit ?? DEFAULT_LIST_LIMIT;

      const data = {
        file: impact.file,
        moduleName: impact.moduleName,
        directDependents: impact.directDependents,
        directDependentCount: impact.directDependents.length,
        transitiveDependents: impact.transitiveDependents,
        transitiveDependentCount: impact.transitiveDependents.length,
        directDependencies: impact.directDependencies,
        directDependencyCount: impact.directDependencies.length,
        transitiveDependencies: impact.transitiveDependencies,
        transitiveDependencyCount: impact.transitiveDependencies.length,
        graphSize: graph.modules.size,
      };

      const lines: string[] = [];
      lines.push(`## Impact: ${impact.file}`);
      lines.push("");
      lines.push(`**Module:** ${impact.moduleName ?? "_(no `module ... where` declaration parsed)_"}`);
      lines.push(`**Graph size:** ${graph.modules.size} module(s) scanned under \`${canonicalRepoRoot}\`.`);
      lines.push("");
      lines.push(`**Direct dependents:** ${impact.directDependents.length}`);
      lines.push(`**Transitive dependents:** ${impact.transitiveDependents.length}`);
      lines.push(`**Direct dependencies:** ${impact.directDependencies.length}`);
      lines.push(`**Transitive dependencies:** ${impact.transitiveDependencies.length}`);
      lines.push("");
      lines.push(...renderList("Direct dependents (modules that `open import` this one)", impact.directDependents, effectiveLimit));
      lines.push("");
      lines.push(...renderList("Transitive dependents (every module that reaches this one through import edges)", impact.transitiveDependents, effectiveLimit));
      lines.push("");
      lines.push(...renderList("Direct dependencies (modules this file `open import`s)", impact.directDependencies, effectiveLimit));
      lines.push("");
      lines.push(...renderList("Transitive dependencies (every module this file's imports transitively reach)", impact.transitiveDependencies, effectiveLimit));

      return makeToolResult(
        okEnvelope({
          tool: "agda_impact",
          summary: `${impact.file}: ${impact.directDependents.length} direct / ${impact.transitiveDependents.length} transitive dependent(s); ${impact.directDependencies.length} direct / ${impact.transitiveDependencies.length} transitive dependency(ies).`,
          data,
          provenance: { file: filePath },
        }),
        lines.join("\n"),
      );
    },
  });
}

function renderList(title: string, items: string[], limit: number): string[] {
  const lines: string[] = [];
  lines.push(`### ${title}`);
  if (items.length === 0) {
    lines.push("_(none)_");
    return lines;
  }
  const head = items.slice(0, limit);
  for (const item of head) lines.push(`- ${item}`);
  if (items.length > limit) {
    lines.push("");
    lines.push(`…and ${items.length - limit} more (full list in structured data; raise \`limit\` to render more).`);
  }
  return lines;
}

function canonicalizeOrFallback(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function emptyImpactData(file: string) {
  return {
    file,
    moduleName: null,
    directDependents: [],
    directDependentCount: 0,
    transitiveDependents: [],
    transitiveDependentCount: 0,
    directDependencies: [],
    directDependencyCount: 0,
    transitiveDependencies: [],
    transitiveDependencyCount: 0,
    graphSize: 0,
  };
}
