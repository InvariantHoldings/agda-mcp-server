import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "example_basic_probe",
    "Show basic extension diagnostics.",
    {
      note: z.string().optional(),
    },
    async ({ note }) => {
      const loadedFile = session.getLoadedFile();
      const goalIds = session.getGoalIds();

      const text = [
        `repoRoot=${repoRoot}`,
        `loadedFile=${loadedFile ?? "(none)"}`,
        `goalCount=${goalIds.length}`,
        `note=${note ?? ""}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  );
}
