// MIT License — see LICENSE
//
// Agda scope tools: why-in-scope, show-module, search-about
// (these use the Agda session for queries)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgdaSession } from "../agda-process.js";
import {
  errorDiagnostic,
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  sessionErrorStateGate,
  validateGoalId,
} from "./tool-helpers.js";
import { optionalGoalIdSchema } from "./tool-schemas.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_why_in_scope",
    description: "Explain why a name is in scope. If goalId is provided, checks within that goal's context; otherwise checks at the top level.",
    category: "navigation",
    protocolCommands: ["Cmd_why_in_scope", "Cmd_why_in_scope_toplevel"],
    inputSchema: {
      name: z.string().describe("The name to look up"),
      goalId: optionalGoalIdSchema.describe("Optional goal ID for context"),
    },
    outputDataSchema: z.object({
      name: z.string(),
      goalId: optionalGoalIdSchema,
      explanation: z.string(),
    }),
    callback: async ({ name, goalId }: { name: string; goalId?: number }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId, "agda_why_in_scope");
        if (invalid) return invalid;
      }
      const unavailable = sessionErrorStateGate(
        session,
        "agda_why_in_scope",
        { name, goalId, explanation: "" },
      );
      if (unavailable) return unavailable;
      try {
        const result = goalId !== undefined
          ? await session.query.whyInScope(goalId, name)
          : await session.query.whyInScopeTopLevel(name);
        let output = `## Why in scope: \`${name}\`\n\n`;
        output += result.explanation
          ? `\`\`\`\n${result.explanation}\n\`\`\`\n`
          : `No information available.\n`;
        return makeToolResult(
          okEnvelope({
            tool: "agda_why_in_scope",
            summary: `Explained why \`${name}\` is in scope.`,
            data: {
              name,
              goalId,
              explanation: result.explanation || "",
            },
            stale: session.isFileStale() || undefined,
          }),
          output,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_why_in_scope",
            summary: message,
            data: { name, goalId, explanation: "" },
            diagnostics: [errorDiagnostic(
              message,
              "why-in-scope-error",
              goalId !== undefined
                ? "Confirm the name is spelled correctly and the goal still exists. Run `agda_goal_catalog` to inspect open goals, or `agda_load` to refresh the session."
                : "Confirm a file is loaded (`agda_session_status`) and the name is in scope at the top level. For a goal-local check, pass `goalId`.",
            )],
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_show_module",
    description: "Show the exported contents of an Agda module. If goalId is provided, shows contents visible from that goal's context; otherwise shows top-level contents.",
    category: "navigation",
    protocolCommands: ["Cmd_show_module_contents", "Cmd_show_module_contents_toplevel"],
    inputSchema: {
      moduleName: z.string().describe("The fully qualified module name"),
      goalId: optionalGoalIdSchema.describe("Optional goal ID for context"),
    },
    outputDataSchema: z.object({
      moduleName: z.string(),
      goalId: optionalGoalIdSchema,
      contents: z.string(),
    }),
    callback: async ({ moduleName, goalId }: { moduleName: string; goalId?: number }) => {
      if (goalId !== undefined) {
        const invalid = validateGoalId(session, goalId, "agda_show_module");
        if (invalid) return invalid;
      }
      const unavailable = sessionErrorStateGate(
        session,
        "agda_show_module",
        { moduleName, goalId, contents: "" },
      );
      if (unavailable) return unavailable;
      try {
        const result = goalId !== undefined
          ? await session.query.showModuleContents(goalId, moduleName)
          : await session.query.showModuleContentsTopLevel(moduleName);
        let output = `## Module contents: ${moduleName}\n\n`;
        output += result.contents
          ? `\`\`\`agda\n${result.contents}\n\`\`\`\n`
          : `No contents found or module not in scope.\n`;
        return makeToolResult(
          okEnvelope({
            tool: "agda_show_module",
            summary: `Loaded module contents for ${moduleName}.`,
            data: {
              moduleName,
              goalId,
              contents: result.contents || "",
            },
            stale: session.isFileStale() || undefined,
          }),
          output,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_show_module",
            summary: message,
            data: { moduleName, goalId, contents: "" },
            diagnostics: [errorDiagnostic(
              message,
              "show-module-error",
              "Confirm the module name is exact and reachable from the loaded file. " +
              "Use `agda_search_about` for a fuzzy lookup, or `agda_file_list` to find the module's source file.",
            )],
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_search_about",
    description: "Search for definitions in the loaded module matching a query string (searches by type components and name fragments).",
    category: "navigation",
    protocolCommands: ["Cmd_search_about_toplevel"],
    inputSchema: { query: z.string().describe("The search query (type components or name fragments)") },
    outputDataSchema: z.object({
      query: z.string(),
      results: z.array(z.object({
        name: z.string(),
        term: z.string(),
      })),
      text: z.string(),
    }),
    callback: async ({ query }: { query: string }) => {
      const unavailable = sessionErrorStateGate(
        session,
        "agda_search_about",
        { query, results: [], text: "" },
      );
      if (unavailable) return unavailable;
      try {
        const result = await session.query.searchAbout(query);
        const rendered = result.text
          ? `\`\`\`agda\n${result.text}\n\`\`\`\n`
          : "No results found.\n";
        let output = `## Search about: "${result.query}"\n\n`;
        output += rendered;
        return makeToolResult(
          okEnvelope({
            tool: "agda_search_about",
            summary: result.results.length > 0
              ? `Found ${result.results.length} search result(s) for ${result.query}.`
              : `No search results found for ${result.query}.`,
            classification: result.results.length > 0 ? "ok" : "no-results",
            data: {
              query: result.query,
              results: result.results,
              text: result.text,
            },
            stale: session.isFileStale() || undefined,
          }),
          output,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_search_about",
            summary: message,
            data: {
              query,
              results: [],
              text: "",
            },
            diagnostics: [errorDiagnostic(
              message,
              "search-about-error",
              "Confirm a file is loaded with `agda_session_status`. " +
              "If the search query is unusual (binders, pragmas), try a simpler identifier-shaped query first.",
            )],
          }),
          message,
        );
      }
    },
  });
}
