// MIT License — see LICENSE
//
// agda_tools_catalog registration. Returns the generated manifest
// view of exposed MCP tools — categories, protocol mappings, and
// schema field names — so agents can introspect the server's tool
// surface without relying on the MCP list-tools response alone.
//
// Also reports the detected Agda version and which extensions,
// feature flags, and protocol-level features are available for that
// version, so agents can tailor their tool use to what this Agda
// installation actually supports.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession, getAgdaCapabilities } from "../agda-process.js";
import { getServerVersion } from "../server-version.js";

import { listToolManifest } from "./manifest.js";
import { makeToolResult, okEnvelope, registerStructuredTool } from "./tool-helpers.js";
import { toolsCatalogDataSchema, tryGetAgdaVersion } from "./reporting-schemas.js";

export function registerToolsCatalog(server: McpServer, session: AgdaSession): void {
  registerStructuredTool({
    server,
    name: "agda_tools_catalog",
    description: "Return the generated manifest view of exposed MCP tools, categories, protocol mappings, and schema field names. Also reports the detected Agda version and which extensions, feature flags, and protocol features are available.",
    category: "reporting",
    outputDataSchema: toolsCatalogDataSchema,
    callback: async () => {
      const tools = listToolManifest();
      const serverVersion = getServerVersion();
      // Trigger version detection if it hasn't run yet (e.g. when this
      // tool is invoked before any other Agda command). tryGetAgdaVersion
      // falls back to a live Cmd_show_version query so the catalog
      // always includes Agda info rather than silently omitting it on
      // first use.
      const detectedAgdaVersion = await tryGetAgdaVersion(session);
      const {
        agdaVersion: capabilityAgdaVersion,
        supportedExtensions,
        supportedFeatureFlags,
        structuredGiveResult,
      } = getAgdaCapabilities(session.getAgdaVersion());
      // Prefer the structured capability version; fall back to the raw
      // string from tryGetAgdaVersion in case the session's parse failed
      // but the showVersion query itself succeeded.
      const agdaVersion = capabilityAgdaVersion ?? detectedAgdaVersion;

      let output = "## Tool catalog\n\n";
      output += `**Server version:** ${serverVersion}\n`;
      if (agdaVersion) {
        output += `**Agda version:** ${agdaVersion}\n`;
      }
      if (supportedExtensions) {
        output += `**Supported source extensions:** ${supportedExtensions.join(", ")}\n`;
      }
      if (supportedFeatureFlags && supportedFeatureFlags.length > 0) {
        output += `**Supported feature flags:** ${supportedFeatureFlags.join(", ")}\n`;
      }
      if (structuredGiveResult !== undefined) {
        output += `**Structured give result (2.9.0+):** ${structuredGiveResult ? "yes" : "no"}\n`;
      }
      output += "\n";
      for (const tool of tools) {
        const commands = tool.protocolCommands.length > 0
          ? tool.protocolCommands.join(", ")
          : "(none)";
        output += `- \`${tool.name}\` [${tool.category}] — ${commands}\n`;
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_tools_catalog",
          summary: `Catalogued ${tools.length} tools.${agdaVersion ? ` Agda ${agdaVersion}.` : ""}`,
          data: {
            serverVersion,
            agdaVersion,
            supportedExtensions,
            supportedFeatureFlags,
            structuredGiveResult,
            tools,
          },
        }),
        output,
      );
    },
  });
}
