import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgdaSession } from "agda-mcp-server";

export function registerCore(server: McpServer, session: AgdaSession): void {
  server.tool(
    "example_goal_count",
    "Show the number of currently known goal IDs.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: String(session.getGoalIds().length) }],
    }),
  );
}

export function registerEnvironment(
  server: McpServer,
  _session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "example_repo_root",
    "Show the AGDA_MCP_ROOT resolved at server startup.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: repoRoot }],
    }),
  );
}
