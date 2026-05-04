// MIT License — see LICENSE
//
// Agent-UX tool group barrel — registers every tool in
// `src/tools/agent-ux/` against the shared MCP server. The actual tool
// definitions live in cohesive sub-modules so no single file exceeds
// the project's 500-line ceiling:
//
//   - agent-ux/migration-tools.ts   stdlib + builtin migration data and lookup
//   - agent-ux/edit-tools.ts        single-file edits (rename, missing clauses, fixity) + error triage
//   - agent-ux/import-tools.ts      import suggestion + clash-source resolution
//   - agent-ux/options-tools.ts     resolved-options + project-config introspection
//   - agent-ux/project-tools.ts     project-wide scans (postulate closure, progress, bulk status)
//   - agent-ux/shared.ts            pure helpers shared across the above
//
// Original entry point — `register(server, session, repoRoot)` — is
// preserved so existing imports in `register-core-tools.ts` and tests
// keep working unchanged.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgdaSession } from "../agda-process.js";
import { registerEditTools } from "./agent-ux/edit-tools.js";
import { registerImportTools } from "./agent-ux/import-tools.js";
import { registerMigrationTools } from "./agent-ux/migration-tools.js";
import { registerOptionsTools } from "./agent-ux/options-tools.js";
import { registerProjectTools } from "./agent-ux/project-tools.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerMigrationTools(server, repoRoot);
  registerEditTools(server, session, repoRoot);
  registerImportTools(server, session, repoRoot);
  registerOptionsTools(server, session, repoRoot);
  registerProjectTools(server, session, repoRoot);
}
