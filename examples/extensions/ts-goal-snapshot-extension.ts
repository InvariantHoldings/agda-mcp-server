import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function register(server: McpServer, session: AgdaSession): void {
  server.tool(
    "example_goal_snapshot",
    "Show context and type information for current goals.",
    {
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ limit }) => {
      const ids = session.getGoalIds().slice(0, limit ?? 10);
      if (ids.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No goals available. Load a file first." }],
        };
      }

      const lines: string[] = [];
      for (const goalId of ids) {
        const info = await session.goalTypeContext(goalId);
        lines.push(`?${goalId}`);
        lines.push(`  type: ${info.type || "(unknown)"}`);
        if (info.context.length > 0) {
          lines.push("  context:");
          for (const entry of info.context) {
            lines.push(`    - ${entry}`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
