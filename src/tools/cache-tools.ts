// MIT License — see LICENSE
//
// Cache-introspection tools.
//
// `agda_cache_info` reports the state of every `.agdai` interface
// artifact for a given source file: where it lives, which Agda
// version produced it, and whether it's older than the source on
// disk. Pairs with the `forceRecompile: true` escape hatch on
// `agda_load` (see register-agda-load.ts) — agents can call this
// first to decide whether they need the more aggressive cache bust,
// and after a load to confirm what was rebuilt.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, realpathSync } from "node:fs";
import { relative } from "node:path";

import type { AgdaSession } from "../agda-process.js";
import { findAgdaiArtifacts, findAgdaProjectRoot } from "../agda/agdai-cache.js";
import { filePathDescription } from "../agda/version-support.js";
import { PathSandboxError, resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../repo-root.js";
import {
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "./tool-helpers.js";

const cacheArtifactSchema = z.object({
  kind: z.enum(["separated", "local"]),
  path: z.string(),
  agdaVersion: z.string().nullable(),
  mtimeMs: z.number(),
  sourceMtimeMs: z.number().nullable(),
  fresh: z.boolean().nullable(),
});

const cacheInfoDataSchema = z.object({
  file: z.string(),
  projectRoot: z.string().nullable(),
  artifacts: z.array(cacheArtifactSchema),
  artifactCount: z.number(),
  freshCount: z.number(),
  staleCount: z.number(),
  hasStaleArtifacts: z.boolean(),
});

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_cache_info",
    description: "Report the state of every `.agdai` interface artifact for a source file. Lists each artifact's path, the Agda version that produced it (for separated builds under `_build/<version>/agda/`), and whether it's older than the on-disk source. Pairs with `agda_load`'s `forceRecompile: true` escape hatch — call this first to decide whether to bust the cache.",
    category: "navigation",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
    },
    outputDataSchema: cacheInfoDataSchema,
    callback: async ({ file }: { file: string }) => {
      let requestedFilePath: string;
      try {
        requestedFilePath = resolveFileWithinRoot(repoRoot, file);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          return makeToolResult(
            errorEnvelope({
              tool: "agda_cache_info",
              summary: `Invalid file path: ${file}`,
              classification: "invalid-path",
              data: emptyCacheInfo(file),
              diagnostics: [{ severity: "error", message: `Invalid file path: ${file}`, code: "invalid-path" }],
            }),
          );
        }
        throw err;
      }
      if (!existsSync(requestedFilePath)) {
        return makeToolResult(
          errorEnvelope({
            tool: "agda_cache_info",
            summary: `File not found: ${file}`,
            classification: "not-found",
            data: emptyCacheInfo(file),
            diagnostics: [{ severity: "error", message: `File not found: ${requestedFilePath}`, code: "not-found" }],
          }),
        );
      }

      const filePath = resolveExistingPathWithinRoot(repoRoot, requestedFilePath);
      const projectRoot = findAgdaProjectRoot(filePath, repoRoot);
      const artifacts = findAgdaiArtifacts(filePath, repoRoot);

      const freshCount = artifacts.filter((a) => a.fresh === true).length;
      const staleCount = artifacts.filter((a) => a.fresh === false).length;
      // Canonicalize the repoRoot against the already-canonicalized
      // filePath so the displayed relative path stays stable on
      // symlinked repo roots. On macOS /var → /private/var this is
      // what keeps the output showing `Mod.agda` instead of
      // `../private/var/.../Mod.agda`. `agda_list_modules` has the
      // same convention, guarded by its symlink regression test.
      const canonicalRepoRoot = canonicalizeOrFallback(repoRoot);
      const relPath = relative(canonicalRepoRoot, filePath);

      const data = {
        file: relPath,
        projectRoot,
        artifacts: artifacts.map((a) => ({
          kind: a.kind,
          path: a.path,
          agdaVersion: a.agdaVersion,
          mtimeMs: a.mtimeMs,
          sourceMtimeMs: a.sourceMtimeMs,
          fresh: a.fresh,
        })),
        artifactCount: artifacts.length,
        freshCount,
        staleCount,
        hasStaleArtifacts: staleCount > 0,
      };

      const lines: string[] = [];
      lines.push(`## Cache info: ${relPath}`);
      lines.push("");
      lines.push(`**Project root:** ${projectRoot ?? "_(none — Agda will use the local-interface fallback)_"}`);
      lines.push(`**Artifacts:** ${artifacts.length} (fresh: ${freshCount}, stale: ${staleCount})`);
      lines.push("");
      if (artifacts.length === 0) {
        lines.push("No `.agdai` artifacts on disk for this source — the next `agda_load` will compile from scratch.");
      } else {
        for (const a of artifacts) {
          const versionLabel = a.kind === "separated" ? `_build/${a.agdaVersion}/agda` : "local (next to source)";
          const freshLabel = a.fresh === true
            ? "fresh"
            : a.fresh === false
            ? "**stale** (source has been modified since cache was written)"
            : "unknown freshness (source mtime unavailable)";
          lines.push(`- **${versionLabel}** — ${freshLabel}`);
          lines.push(`  - \`${a.path}\``);
          if (a.sourceMtimeMs !== null) {
            const ageMs = a.sourceMtimeMs - a.mtimeMs;
            const ageNote = ageMs > 0 ? `source is ${Math.round(ageMs / 1000)}s newer` : `cache is ${Math.round(-ageMs / 1000)}s newer`;
            lines.push(`  - cache mtime ${new Date(a.mtimeMs).toISOString()}; source mtime ${new Date(a.sourceMtimeMs).toISOString()} (${ageNote})`);
          } else {
            lines.push(`  - cache mtime ${new Date(a.mtimeMs).toISOString()}; source mtime unavailable`);
          }
        }
      }
      if (staleCount > 0) {
        lines.push("");
        lines.push("**Tip:** call `agda_load` with `forceRecompile: true` to bust every artifact above before reloading.");
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_cache_info",
          summary: artifacts.length === 0
            ? `No .agdai artifacts on disk for ${relPath}.`
            : `${artifacts.length} .agdai artifact(s) for ${relPath} (fresh: ${freshCount}, stale: ${staleCount}).`,
          data,
          provenance: { file: filePath },
        }),
        lines.join("\n"),
      );
    },
  });
}

function canonicalizeOrFallback(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function emptyCacheInfo(file: string) {
  return {
    file,
    projectRoot: null,
    artifacts: [],
    artifactCount: 0,
    freshCount: 0,
    staleCount: 0,
    hasStaleArtifacts: false,
  };
}
