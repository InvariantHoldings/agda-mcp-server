// MIT License — see LICENSE
//
// Agda scope tools: why-in-scope, show-module, search-about
// (these use the Agda session for queries)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import { stalenessWarning, validateGoalId, text } from "./tool-helpers.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  server.tool(
    "agda_why_in_scope",
    "Explain why a name is in scope. If goalId is provided, checks within that goal's context; otherwise checks at the top level.",
    {
      name: z.string().describe("The name to look up"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ name, goalId }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId);
        if (invalid) return invalid;
      }
      try {
        const warn = stalenessWarning(session);
        const result = goalId !== undefined
          ? await session.query.whyInScope(goalId, name)
          : await session.query.whyInScopeTopLevel(name);
        let output = warn + `## Why in scope: \`${name}\`\n\n`;
        output += result.explanation
          ? `\`\`\`\n${result.explanation}\n\`\`\`\n`
          : `No information available.\n`;
        return text(output);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_show_module",
    "Show the exported contents of an Agda module. If goalId is provided, shows contents visible from that goal's context; otherwise shows top-level contents.",
    {
      moduleName: z.string().describe("The fully qualified module name"),
      goalId: z.number().optional().describe("Optional goal ID for context"),
    },
    async ({ moduleName, goalId }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId);
        if (invalid) return invalid;
      }
      try {
        const warn = stalenessWarning(session);
        const result = goalId !== undefined
          ? await session.query.showModuleContents(goalId, moduleName)
          : await session.query.showModuleContentsTopLevel(moduleName);
        let output = warn + `## Module contents: ${moduleName}\n\n`;
        output += result.contents
          ? `\`\`\`agda\n${result.contents}\n\`\`\`\n`
          : `No contents found or module not in scope.\n`;
        return text(output);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    "agda_search_about",
    "Search for definitions in the loaded module matching a query string (searches by type components and name fragments).",
    { query: z.string().describe("The search query (type components or name fragments)") },
    async ({ query }) => {
      try {
        const warn = stalenessWarning(session);
        const result = await session.query.searchAbout(query);
        let output = warn + `## Search about: "${query}"\n\n`;
        output += result.results
          ? `\`\`\`agda\n${result.results}\n\`\`\`\n`
          : `No results found.\n`;
        return text(output);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
