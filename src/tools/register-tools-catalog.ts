// MIT License — see LICENSE
//
// agda_tools_catalog registration. Returns the generated manifest
// view of exposed MCP tools — categories, protocol mappings, and
// schema field names — so agents can introspect the server's tool
// surface without relying on the MCP list-tools response alone.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getServerVersion } from "../server-version.js";

import { listToolManifest } from "./manifest.js";
import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";
import { toolsCatalogDataSchema } from "./reporting-schemas.js";

export function registerToolsCatalog(server: McpServer): void {
  registerStructuredTool({
    server,
    name: "agda_tools_catalog",
    description: "Return the generated manifest view of exposed MCP tools, categories, protocol mappings, and schema field names.",
    category: "reporting",
    outputDataSchema: toolsCatalogDataSchema,
    callback: async () => {
      const tools = listToolManifest();
      const serverVersion = getServerVersion();
      let output = "## Tool catalog\n\n";
      output += `**Server version:** ${serverVersion}\n\n`;
      for (const tool of tools) {
        const commands = tool.protocolCommands.length > 0
          ? tool.protocolCommands.join(", ")
          : "(none)";
        output += `- \`${tool.name}\` [${tool.category}] — ${commands}\n`;
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_tools_catalog",
          summary: `Catalogued ${tools.length} tools.`,
          data: {
            serverVersion,
            tools,
          },
        }),
        output,
      );
    },
  });
}
