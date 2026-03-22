// MIT License — see LICENSE
//
// Navigation and code-browsing tools: reading modules, listing modules,
// checking postulates, searching definitions, why-in-scope, show-module,
// search-about

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve, relative } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { AgdaSession } from "../agda-process.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  // ── agda_read_module ──────────────────────────────────────────────
  server.tool(
    "agda_read_module",
    "Read an Agda module file and return its contents with line numbers.",
    {
      file: z.string().describe("Path to the .agda file"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const numbered = lines
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");

      return {
        content: [{
          type: "text" as const,
          text: `## ${relative(repoRoot, filePath)}\n\n\`\`\`agda\n${numbered}\n\`\`\``,
        }],
      };
    },
  );

  // ── agda_list_modules ─────────────────────────────────────────────
  server.tool(
    "agda_list_modules",
    "List Agda modules in a directory tier (MathLib, Foundation, Kernel, Research, Extensions, etc.).",
    {
      tier: z.string().describe("The tier to list, e.g. 'Kernel', 'Foundation', 'MathLib'"),
    },
    async ({ tier }) => {
      const tierDir = resolve(repoRoot, "agda", tier);
      if (!existsSync(tierDir)) {
        return {
          content: [{
            type: "text" as const,
            text: `Tier directory not found: agda/${tier}\nAvailable: MathLib, Foundation, Kernel, Research, Extensions, TrustedCompute`,
          }],
        };
      }

      const modules: string[] = [];
      function walk(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(resolve(dir, entry.name));
          else if (entry.name.endsWith(".agda"))
            modules.push(relative(repoRoot, resolve(dir, entry.name)));
        }
      }
      walk(tierDir);
      modules.sort();

      return {
        content: [{
          type: "text" as const,
          text: `## agda/${tier} (${modules.length} modules)\n\n${modules.map((m) => `- ${m}`).join("\n")}`,
        }],
      };
    },
  );

  // ── agda_check_postulates ─────────────────────────────────────────
  server.tool(
    "agda_check_postulates",
    "Check an Agda file for postulate declarations. In Kernel/ files, postulates are forbidden by construction.",
    {
      file: z.string().describe("Path to the .agda file"),
    },
    async ({ file }) => {
      const filePath = resolve(repoRoot, file);
      if (!existsSync(filePath)) {
        return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }] };
      }

      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const postulates: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (/^\s*postulate\b/.test(lines[i])) {
          postulates.push(`Line ${i + 1}: ${lines[i].trim()}`);
        }
      }

      const relPath = relative(repoRoot, filePath);
      const isKernel = relPath.startsWith("agda/Kernel/");

      let output = `## Postulate check: ${relPath}\n\n`;
      if (postulates.length === 0) {
        output += "No postulates found. Fully constructive.\n";
      } else {
        output += `**${postulates.length} postulate(s) found**`;
        if (isKernel) output += ` **VIOLATION: postulates are forbidden in Kernel/**`;
        output += "\n\n";
        for (const p of postulates) output += `- ${p}\n`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // ── agda_search_definitions ───────────────────────────────────────
  server.tool(
    "agda_search_definitions",
    "Search for a definition, theorem, or type name across Agda modules.",
    {
      query: z.string().describe("The name or pattern to search for"),
      tier: z.string().optional().describe("Optional tier to limit search (Kernel, Foundation, etc.)"),
    },
    async ({ query, tier }) => {
      const searchRoot = tier
        ? resolve(repoRoot, "agda", tier)
        : resolve(repoRoot, "agda");

      if (!existsSync(searchRoot)) {
        return { content: [{ type: "text" as const, text: `Directory not found: ${searchRoot}` }] };
      }

      const matches: Array<{ file: string; line: number; text: string }> = [];

      function searchDir(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) searchDir(resolve(dir, entry.name));
          else if (entry.name.endsWith(".agda")) {
            const fp = resolve(dir, entry.name);
            const fileContent = readFileSync(fp, "utf-8");
            const lines = fileContent.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(query)) {
                matches.push({ file: relative(repoRoot, fp), line: i + 1, text: lines[i].trim() });
              }
            }
          }
        }
      }
      searchDir(searchRoot);

      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: `No matches for "${query}" in ${tier ?? "agda/"}` }] };
      }

      const capped = matches.slice(0, 50);
      let output = `## Search: "${query}" (${matches.length} matches${matches.length > 50 ? ", showing first 50" : ""})\n\n`;
      for (const m of capped) output += `- **${m.file}:${m.line}** \`${m.text}\`\n`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  // ── agda_why_in_scope ─────────────────────────────────────────────
  server.tool(
    "agda_why_in_scope",
    "Explain why a name is in scope. If goalId is provided, checks within that goal's context; otherwise checks at the top level.",
    {
      name: z.string().describe("The name to look up"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ name, goalId }) => {
      try {
        const result = goalId !== undefined
          ? await session.whyInScope(goalId, name)
          : await session.whyInScopeTopLevel(name);
        let output = `## Why in scope: \`${name}\`\n\n`;
        output += result.explanation
          ? `\`\`\`\n${result.explanation}\n\`\`\`\n`
          : `No information available.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_show_module ──────────────────────────────────────────────
  server.tool(
    "agda_show_module",
    "Show the exported contents of an Agda module. If goalId is provided, shows contents visible from that goal's context; otherwise shows top-level contents.",
    {
      moduleName: z.string().describe("The fully qualified module name"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ moduleName, goalId }) => {
      try {
        const result = goalId !== undefined
          ? await session.showModuleContents(goalId, moduleName)
          : await session.showModuleContentsTopLevel(moduleName);
        let output = `## Module contents: ${moduleName}\n\n`;
        output += result.contents
          ? `\`\`\`agda\n${result.contents}\n\`\`\`\n`
          : `No contents found or module not in scope.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  // ── agda_search_about ─────────────────────────────────────────────
  server.tool(
    "agda_search_about",
    "Search for definitions in the loaded module matching a query string (searches by type components and name fragments).",
    {
      query: z.string().describe("The search query (type components or name fragments)"),
    },
    async ({ query }) => {
      try {
        const result = await session.searchAbout(query);
        let output = `## Search about: "${query}"\n\n`;
        output += result.results
          ? `\`\`\`agda\n${result.results}\n\`\`\`\n`
          : `No results found.\n`;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );
}
