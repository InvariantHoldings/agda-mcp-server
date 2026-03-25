import { z } from "zod";

/**
 * Plain JavaScript extension example.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("agda-mcp-server").AgdaSession} session
 * @param {string} repoRoot
 */
export function register(server, session, repoRoot) {
  server.tool(
    "example_js_probe",
    "JavaScript extension example: show loaded file and goal IDs.",
    {
      includeGoals: z.boolean().optional(),
    },
    async ({ includeGoals }) => {
      const loadedFile = session.getLoadedFile();
      const goalIds = includeGoals ? session.getGoalIds() : [];

      const text = [
        `repoRoot=${repoRoot}`,
        `loadedFile=${loadedFile ?? "(none)"}`,
        `goalIds=${goalIds.join(",")}`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
      };
    },
  );
}
