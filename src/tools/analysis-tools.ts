// MIT License — see LICENSE
//
// AI-focused analysis tools: proof status dashboard, goal analysis
// with suggestions, smart reload with diff, and term search.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { registerGoalTextTool, registerTextTool } from "./tool-helpers.js";
import {
  parseContextEntry,
  deriveSuggestions,
  findMatchingTerms,
} from "../agda/goal-analysis.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  // ── agda_proof_status — one-call proof progress dashboard ──────

  registerTextTool({
    server,
    name: "agda_proof_status",
    description: "Get a complete proof state snapshot: loaded file, staleness, all goals with types, and constraints. Use this instead of calling agda_session_status + agda_metas + agda_constraints separately.",
    category: "analysis",
    inputSchema: {},
    callback: async () => {
      const file = session.getLoadedFile();
      if (!file) return "No file loaded. Call `agda_load` first.";

      const metas = await session.goal.metas();
      const constraints = await session.query.constraints();

      let output = `## Proof Status\n\n`;
      output += `**File:** ${file}\n`;
      output += `**Goals:** ${metas.goals.length} unsolved\n`;
      if (constraints.text) {
        output += `**Constraints:** yes\n`;
      }
      output += "\n";

      if (metas.goals.length > 0) {
        output += "### Goals\n\n";
        for (const g of metas.goals) {
          output += `- **?${g.goalId}** : \`${g.type}\`\n`;
        }
        output += "\n";
      }

      if (constraints.text) {
        output += `### Constraints\n\n\`\`\`\n${constraints.text}\n\`\`\`\n`;
      }

      if (metas.goals.length === 0) {
        output += "All goals solved.\n";
      }

      return output;
    },
  });

  // ── agda_goal_analysis — per-goal actionability ────────────────

  registerGoalTextTool({
    server,
    session,
    name: "agda_goal_analysis",
    description: "Analyze a goal: show its type, parsed context, splittable variables, and suggested next actions. Use this to decide what proof step to take.",
    category: "analysis",
    inputSchema: {
      goalId: z.number().describe("The goal ID to analyze"),
    },
    callback: async ({ goalId }) => {
      const info = await session.goal.typeContext(goalId);
      const contextEntries = info.context.map(parseContextEntry);
      const suggestions = deriveSuggestions(info.type, contextEntries);

      let output = `## Goal Analysis: ?${goalId}\n\n`;
      output += `### Goal Type\n\n\`\`\`agda\n${info.type || "(unknown)"}\n\`\`\`\n\n`;

      if (contextEntries.length > 0) {
        output += `### Context (${contextEntries.length} entries)\n\n`;
        for (const e of contextEntries) {
          const prefix = e.isImplicit ? "(implicit) " : "";
          output += `- ${prefix}\`${e.name}\` : \`${e.type}\`\n`;
        }
        output += "\n";
      }

      const splittable = contextEntries.filter((e) => !e.isImplicit && e.name && e.type);
      if (splittable.length > 0) {
        output += `### Splittable Variables\n\n`;
        for (const v of splittable) {
          output += `- \`${v.name}\` : \`${v.type}\`\n`;
        }
        output += "\n";
      }

      output += `### Suggested Actions\n\n`;
      for (const s of suggestions) {
        let desc = `**${s.action}**`;
        if (s.expr) desc += ` with \`${s.expr}\``;
        if (s.variable) desc += ` on \`${s.variable}\``;
        output += `- ${desc} — ${s.reason}\n`;
      }

      return output;
    },
  });

  // ── agda_reload — smart reload with goal diff ─────────────────

  registerTextTool({
    server,
    name: "agda_reload",
    description: "Reload the currently loaded file and report what changed: which goals were solved, which are new, and the current proof state.",
    category: "analysis",
    inputSchema: {},
    callback: async () => {
      const prevFile = session.getLoadedFile();
      if (!prevFile) return "No file loaded. Call `agda_load` first.";

      const prevGoalIds = session.getGoalIds();
      const wasStale = session.isFileStale();

      try {
        const result = await session.load(prevFile);
        const newGoalIds = result.goals.map((g) => g.goalId);
        const solved = prevGoalIds.filter((id) => !newGoalIds.includes(id));
        const created = newGoalIds.filter((id) => !prevGoalIds.includes(id));
        const unchanged = newGoalIds.filter((id) => prevGoalIds.includes(id));

        let output = `## Reload: ${prevFile.split("/").pop()}\n\n`;

        if (wasStale) {
          output += "**File was modified since last load.**\n\n";
        }

        output += `**Status:** ${result.success ? "OK" : "FAILED"}\n`;
        output += `**Goals:** ${newGoalIds.length} total\n`;

        if (solved.length > 0) {
          output += `**Solved:** ${solved.map((id) => `?${id}`).join(", ")}\n`;
        }
        if (created.length > 0) {
          output += `**New:** ${created.map((id) => `?${id}`).join(", ")}\n`;
        }
        if (unchanged.length > 0) {
          output += `**Unchanged:** ${unchanged.map((id) => `?${id}`).join(", ")}\n`;
        }

        if (result.errors.length > 0) {
          output += `\n### Errors\n\n`;
          for (const err of result.errors) {
            output += `\`\`\`\n${err}\n\`\`\`\n`;
          }
        }

        return output;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // ── agda_term_search — find terms of matching type ────────────

  registerGoalTextTool({
    server,
    session,
    name: "agda_term_search",
    description: "Search the goal's context for terms whose type matches the goal type (or a custom target type). Returns candidate expressions that might fill the goal.",
    category: "analysis",
    inputSchema: {
      goalId: z.number().describe("The goal ID to search in"),
      targetType: z.string().optional().describe("Optional type to search for (defaults to the goal's type)"),
      scope: z.enum(["local", "module", "imported"]).optional().describe("Search scope: local context only, module-wide, or imported definitions"),
      offset: z.number().int().min(0).optional().describe("0-based pagination offset"),
      limit: z.number().int().min(1).max(200).optional().describe("Maximum results to return"),
    },
    callback: async ({ goalId, targetType, scope, offset, limit }) => {
      const info = await session.goal.typeContext(goalId);
      const target = (targetType as string) || info.type;
      const contextEntries = info.context.map(parseContextEntry);
      const effectiveScope = (scope as "local" | "module" | "imported" | undefined) ?? "module";
      const localMatches = findMatchingTerms(target, contextEntries).map((match) => ({
        name: match.name,
        type: match.type,
        source: "local" as const,
      }));

      let moduleMatches: Array<{ name: string; type: string; source: "module" | "imported" }> = [];
      if (effectiveScope !== "local") {
        try {
          const about = await session.query.searchAbout(target);
          const moduleSource: "module" | "imported" =
            effectiveScope === "imported" ? "imported" : "module";
          moduleMatches = about.results.map((entry) => ({
            name: entry.name,
            type: entry.term,
            source: moduleSource,
          }));
        } catch {
          moduleMatches = [];
        }
      }

      const localNames = new Set(localMatches.map((entry) => entry.name));
      let merged = [] as Array<{ name: string; type: string; source: "local" | "module" | "imported" }>;
      if (effectiveScope === "local") {
        merged = localMatches;
      } else if (effectiveScope === "imported") {
        merged = moduleMatches.filter((entry) => !localNames.has(entry.name));
      } else {
        merged = [...localMatches, ...moduleMatches];
      }

      const seen = new Set<string>();
      merged = merged.filter((entry) => {
        const key = `${entry.source}:${entry.name}:${entry.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const effectiveOffset = (offset as number | undefined) ?? 0;
      const effectiveLimit = (limit as number | undefined) ?? 30;
      const matches = merged.slice(effectiveOffset, effectiveOffset + effectiveLimit);

      let output = `## Term Search in ?${goalId}\n\n`;
      output += `**Target type:** \`${target}\`\n\n`;
      output += `**Scope:** \`${effectiveScope}\`\n`;
      output += `**Total candidates:** ${merged.length}\n\n`;

      if (matches.length > 0) {
        output += `### Matching terms (${matches.length} shown)\n\n`;
        for (const m of matches) {
          output += `- \`${m.name}\` : \`${m.type}\` (${m.source})\n`;
        }
        if (merged.length > effectiveOffset + effectiveLimit) {
          output += `\nMore candidates available. Re-call with \`offset: ${effectiveOffset + effectiveLimit}\`.\n`;
        }
      } else {
        output += "No matching candidates found in the requested scope.\n";
      }

      // Provide hints for common patterns
      if (target.includes("≡")) {
        output += `\n**Hint:** Goal is an equality. Consider \`refl\`, \`cong\`, or \`sym\`.\n`;
      }
      if (target.includes("→")) {
        output += `\n**Hint:** Goal is a function type. Consider \`refine\` or \`intro\` to introduce arguments.\n`;
      }

      return output;
    },
  });
}
