// MIT License — see LICENSE
//
// Session status and process-control tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { relative } from "node:path";

import {
  AgdaSession,
  getAgdaCapabilities,
} from "../agda-process.js";
import { availableSessionTools, processCommandDataSchema, sessionStatusDataSchema, versionDataSchema } from "./tool-presentation.js";
import {
  errorEnvelope,
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  stalenessWarning,
} from "../tools/tool-helpers.js";

export function registerSessionProcessTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_session_status",
    description: "Show the current Agda session status: phase, loaded file, and available goal IDs.",
    category: "session",
    outputDataSchema: sessionStatusDataSchema,
    callback: async () => {
      const loadedFile = session.getLoadedFile();
      const goalIds = session.getGoalIds();
      const phase = session.getPhase();
      const tools = availableSessionTools(loadedFile !== null);
      const relativeFile = loadedFile ? relative(repoRoot, loadedFile) : null;

      let output = `${stalenessWarning(session)}## Agda Session Status\n\n`;
      output += `**Phase:** ${phase}\n`;
      output += `**Loaded file:** ${relativeFile ?? "(none)"}\n`;
      output += `**Goal IDs:** ${goalIds.length > 0 ? goalIds.map((id) => `?${id}`).join(", ") : "(none)"}\n\n`;
      output += "### Available tools\n";
      for (const tool of tools) {
        output += `- \`${tool.name}\` — ${tool.description}\n`;
      }

      return makeToolResult(
        okEnvelope({
          tool: "agda_session_status",
          summary: loadedFile
            ? `Session is ${phase} with ${goalIds.length} goal IDs available.`
            : `Session is ${phase} with no file loaded.`,
          data: {
            phase,
            loadedFile: relativeFile,
            goalIds,
            availableTools: tools,
          },
          stale: session.isFileStale() || undefined,
          provenance: { loadedFile },
        }),
        output,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_show_version",
    description: "Show the Agda version and runtime capabilities: supported source extensions, feature flags, and protocol changes.",
    category: "process",
    protocolCommands: ["Cmd_show_version"],
    outputDataSchema: versionDataSchema,
    callback: async () => {
      try {
        const result = await session.query.showVersion();
        const version = result.version || "(version unavailable)";

        // Prefer the cached parsed version (populated by inline detection before
        // this command ran) to avoid an extra Cmd_show_version round-trip.
        const { agdaVersion, supportedExtensions, supportedFeatureFlags, structuredGiveResult } =
          getAgdaCapabilities(session.getAgdaVersion());

        let output = `## Agda version\n\n${version}\n`;
        if (supportedExtensions) {
          output += `\n**Supported source extensions:** ${supportedExtensions.join(", ")}\n`;
        }
        if (supportedFeatureFlags && supportedFeatureFlags.length > 0) {
          output += `**Supported feature flags:** ${supportedFeatureFlags.join(", ")}\n`;
        }
        if (structuredGiveResult !== undefined) {
          output += `**Structured give result (2.9.0+):** ${structuredGiveResult ? "yes" : "no"}\n`;
        }

        return makeToolResult(
          okEnvelope({
            tool: "agda_show_version",
            summary: `Agda version: ${version}`,
            data: {
              version,
              agdaVersion,
              supportedExtensions,
              supportedFeatureFlags,
              structuredGiveResult,
            },
            provenance: { protocolCommands: ["Cmd_show_version"] },
          }),
          output,
        );
      } catch (err) {
        const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_show_version",
            summary: message,
            classification: "process-error",
            data: { version: "" },
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_abort",
    description: "Send Cmd_abort to the running Agda process.",
    category: "process",
    protocolCommands: ["Cmd_abort"],
    outputDataSchema: processCommandDataSchema,
    callback: async () => {
      try {
        await session.abort();
        return makeToolResult(
          okEnvelope({
            tool: "agda_abort",
            summary: "Abort command sent to Agda.",
            data: { command: "abort", delivered: true },
            provenance: { protocolCommands: ["Cmd_abort"] },
          }),
          "Abort command sent to Agda.\n",
        );
      } catch (err) {
        const message = `Abort failed: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_abort",
            summary: message,
            classification: "process-error",
            data: { command: "abort", delivered: false },
          }),
          message,
        );
      }
    },
  });

  registerStructuredTool({
    server,
    name: "agda_exit",
    description: "Send Cmd_exit to the running Agda process and let the session shut down cleanly.",
    category: "process",
    protocolCommands: ["Cmd_exit"],
    outputDataSchema: processCommandDataSchema,
    callback: async () => {
      try {
        await session.exit();
        return makeToolResult(
          okEnvelope({
            tool: "agda_exit",
            summary: "Exit command sent to Agda.",
            data: { command: "exit", delivered: true },
            provenance: { protocolCommands: ["Cmd_exit"] },
          }),
          "Exit command sent to Agda.\n",
        );
      } catch (err) {
        const message = `Exit failed: ${err instanceof Error ? err.message : String(err)}`;
        return makeToolResult(
          errorEnvelope({
            tool: "agda_exit",
            summary: message,
            classification: "process-error",
            data: { command: "exit", delivered: false },
          }),
          message,
        );
      }
    },
  });
}
