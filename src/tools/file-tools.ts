// MIT License — see LICENSE
//
// Barrel registration for the file-navigation tool family
// (`agda_read_module`, `agda_list_modules`, `agda_check_postulates`,
// `agda_search_definitions`). Pure filesystem tools — none of these
// require an active Agda session beyond best-effort version detection
// for the source-extension filter. The actual callbacks live in
// focused per-tool modules under `src/tools/file/` so this barrel
// stays under the 500-line ceiling and each tool's logic can be read
// in isolation.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { register as registerCheckPostulates } from "./file/check-postulates.js";
import { register as registerListModules } from "./file/list-modules.js";
import { register as registerReadModule } from "./file/read-module.js";
import { register as registerSearchDefinitions } from "./file/search-definitions.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerReadModule(server, session, repoRoot);
  registerListModules(server, session, repoRoot);
  registerCheckPostulates(server, session, repoRoot);
  registerSearchDefinitions(server, session, repoRoot);
}
