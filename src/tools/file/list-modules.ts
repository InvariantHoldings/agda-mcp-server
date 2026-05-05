// MIT License — see LICENSE
//
// `agda_list_modules` — paginated tier-scoped Agda module listing.
//
// Walks the requested tier root with sandbox + permission-tolerant
// semantics: a single unreadable subtree is reported as an explicit
// "skipped" entry rather than crashing the whole walk. Pagination
// (`offset`, `limit`, `pattern`) keeps the response small enough for
// MCP token budgets even on many-hundred-module projects.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import { isAgdaSourceFile } from "../../agda/version-support.js";
import { logger } from "../../agda/logger.js";
import {
  resolveExistingPathWithinRoot,
  resolveFileWithinRoot,
} from "../../repo-root.js";
import { ToolInvocationError, registerTextTool } from "../tool-helpers.js";
import {
  LIST_MODULES_DEFAULT_LIMIT,
  LIST_MODULES_MAX_LIMIT,
  relativeToRequestedRoot,
  resolveExistingChildWithinRoot,
} from "./shared.js";

/**
 * Discover the immediate child directories of `<repoRoot>/agda` so
 * a not-found-tier diagnostic can list the actually-available
 * tiers instead of a hardcoded project-specific list. Returns an
 * empty array if `agda/` doesn't exist, isn't readable, or contains
 * no directories — the caller falls through to a generic hint.
 *
 * Defensive against unreadable directories (permission-denied races,
 * broken symlinks): swallow the error and return whatever was seen
 * so far. The diagnostic is informational, not authoritative — a
 * partial list beats a crash.
 */
function discoverAvailableTiers(repoRoot: string): string[] {
  const agdaRoot = resolve(repoRoot, "agda");
  if (!existsSync(agdaRoot)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(agdaRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerTextTool({
    server,
    name: "agda_list_modules",
    description: "List Agda modules under a tier directory (`agda/<tier>/...`). Always reports the total module count; paginated to keep responses small (default page size 25). Use `offset` to scroll, `limit` to enlarge the page, and `pattern` for a case-insensitive substring filter on the relative path. Call with an unknown tier to get a not-found diagnostic that lists the tier directories actually present in the project.",
    category: "navigation",
    // Filesystem-only walk + best-effort version detection — works
    // without a loaded file. Discoverable via `agda_session_status`
    // before any load so an agent can pick which module to load.
    requiresLoadedSession: false,
    inputSchema: {
      tier: z.string().describe("The tier directory under agda/ to list. Pass any subdirectory name; agda_list_modules itself is the discovery tool — call with an unknown tier to get a list of what's available in this project."),
      offset: z.number().int().min(0).optional().describe("0-based starting index into the sorted result list. Defaults to 0."),
      limit: z.number().int().min(1).max(LIST_MODULES_MAX_LIMIT).optional().describe(
        `Maximum number of modules to return in this page. Defaults to ${LIST_MODULES_DEFAULT_LIMIT}; capped at ${LIST_MODULES_MAX_LIMIT}.`,
      ),
      pattern: z.string().optional().describe("Case-insensitive substring filter applied to each module's relative path before pagination."),
    },
    outputDataSchema: z.object({
      text: z.string(),
      tier: z.string(),
      pattern: z.string().nullable(),
      total: z.number(),
      filtered: z.number(),
      offset: z.number(),
      limit: z.number(),
      modules: z.array(z.string()),
      hasMore: z.boolean(),
      nextOffset: z.number().nullable(),
      unreadableSubtrees: z.array(z.string()),
    }),
    callback: async ({ tier, offset, limit, pattern }: { tier: string; offset?: number; limit?: number; pattern?: string }) => {
      const requestedTierDir = resolveFileWithinRoot(repoRoot, join("agda", tier));
      if (!existsSync(requestedTierDir)) {
        const availableTiers = discoverAvailableTiers(repoRoot);
        const tierList = availableTiers.length > 0
          ? availableTiers.join(", ")
          : "(no tier subdirectories found under agda/)";
        const nextAction = availableTiers.length > 0
          ? `Pass an existing tier directory. Available in this project: ${tierList}. ` +
            "Use `agda_search_definitions` with no `tier` to scan the whole project root."
          : "No tier subdirectories were found under `agda/`. " +
            "Either the tier path is wrong or this project does not use a tier layout. " +
            "Use `agda_search_definitions` with no `tier` to scan the project root directly.";
        throw new ToolInvocationError({
          message: `Tier directory not found: agda/${tier}`,
          classification: "not-found",
          diagnostics: [
            {
              severity: "error",
              message: `Tier directory not found: agda/${tier}`,
              code: "not-found",
              nextAction,
            },
            {
              severity: "info",
              message: `Available tiers: ${tierList}`,
              code: "available-tiers",
            },
          ],
          data: { tier },
          text: `Tier directory not found: agda/${tier}\nAvailable: ${tierList}`,
        });
      }
      const tierDir = resolveExistingPathWithinRoot(repoRoot, requestedTierDir);
      // Ensure version detection has run so isAgdaSourceFile() filters by the
      // actually-installed Agda's supported extensions rather than being
      // permissive (all extensions) when this tool is invoked first.
      if (!session.getAgdaVersion()) {
        try { await session.query.showVersion(); } catch (err) {
          logger.trace("agda_list_modules: version detection best-effort failed", { err });
        }
      }
      const modules: string[] = [];
      const unreadableDirs: string[] = [];
      function walk(dir: string, requestedDir: string, displayPrefix: string): void {
        let entries: import("node:fs").Dirent[];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          // One unreadable subdir (permission denied, broken
          // symlink, ENOTDIR race from a concurrent rename) must
          // not crash the entire listing. Collect the path so the
          // response can tell the caller which subtrees were
          // skipped, then keep walking the siblings.
          unreadableDirs.push(displayPrefix);
          logger.trace("agda_list_modules: readdir failed, skipping subtree", { dir, err });
          return;
        }
        for (const entry of entries) {
          const nextRequestedPath = resolve(requestedDir, entry.name);
          const nextDisplayPath = join(displayPrefix, entry.name);
          if (entry.isDirectory()) walk(resolve(dir, entry.name), nextRequestedPath, nextDisplayPath);
          else if (isAgdaSourceFile(entry.name, session.getAgdaVersion() ?? undefined)) {
            const canonicalPath = resolveExistingChildWithinRoot(repoRoot, nextRequestedPath);
            if (canonicalPath) {
              modules.push(nextDisplayPath);
            }
          }
        }
      }
      walk(
        tierDir,
        requestedTierDir,
        relativeToRequestedRoot(repoRoot, requestedTierDir),
      );
      modules.sort();

      const normalizedPattern = pattern?.toLowerCase() ?? null;
      const filtered = normalizedPattern === null
        ? modules
        : modules.filter((m) => m.toLowerCase().includes(normalizedPattern));

      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? LIST_MODULES_DEFAULT_LIMIT;
      const page = filtered.slice(effectiveOffset, effectiveOffset + effectiveLimit);
      const nextOffset = effectiveOffset + page.length;
      const hasMore = nextOffset < filtered.length;

      const totalLine = normalizedPattern === null
        ? `**Total:** ${modules.length} modules in \`agda/${tier}\`.`
        : `**Total:** ${filtered.length} matches for \`${pattern}\` (out of ${modules.length} modules in \`agda/${tier}\`).`;
      const rangeStart = page.length === 0 ? effectiveOffset : effectiveOffset + 1;
      const rangeEnd = effectiveOffset + page.length;
      const showingLine = page.length === 0
        ? `**Showing:** none — \`offset: ${effectiveOffset}\` is past the end (${filtered.length} total).`
        : `**Showing:** ${rangeStart}–${rangeEnd} of ${filtered.length}.`;

      const lines = [
        `## agda/${tier}`,
        "",
        totalLine,
        showingLine,
        "",
      ];
      if (page.length > 0) {
        for (const m of page) lines.push(`- ${m}`);
      }
      if (hasMore) {
        lines.push("");
        lines.push(`**More results available.** Re-call with \`offset: ${nextOffset}\` to fetch the next page.`);
      }
      if (unreadableDirs.length > 0) {
        lines.push("");
        lines.push(`**Skipped ${unreadableDirs.length} unreadable subtree(s):** ${unreadableDirs.join(", ")}. Check file permissions or broken symlinks; modules beneath these directories are not included in the total count.`);
      }
      return {
        text: lines.join("\n"),
        data: {
          tier,
          pattern: pattern ?? null,
          total: modules.length,
          filtered: filtered.length,
          offset: effectiveOffset,
          limit: effectiveLimit,
          modules: page,
          hasMore,
          nextOffset: hasMore ? nextOffset : null,
          unreadableSubtrees: unreadableDirs,
        },
      };
    },
  });
}
