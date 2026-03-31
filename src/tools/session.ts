// MIT License — see LICENSE
//
// Composition entrypoint for session-oriented tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../agda-process.js";
import { registerSessionLoadTools } from "../session/load-tool-registration.js";
import { registerSessionProcessTools } from "../session/process-tool-registration.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerSessionLoadTools(server, session, repoRoot);
  registerSessionProcessTools(server, session, repoRoot);
}
