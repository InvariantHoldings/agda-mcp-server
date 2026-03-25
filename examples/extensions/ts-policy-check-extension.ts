import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgdaSession } from "agda-mcp-server";

export function register(
  server: McpServer,
  _session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "example_require_pragma",
    "Check whether an Agda file contains a required OPTIONS fragment.",
    {
      file: z.string().describe("Relative or absolute .agda file path"),
      required: z.string().default("--safe"),
    },
    async ({ file, required }) => {
      const target = resolve(repoRoot, file);
      if (!existsSync(target)) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${target}` }],
        };
      }

      const text = readFileSync(target, "utf8");
      const ok = text.includes(required);

      return {
        content: [{
          type: "text" as const,
          text: ok
            ? `PASS: found required fragment ${required}`
            : `FAIL: missing required fragment ${required}`,
        }],
      };
    },
  );
}
