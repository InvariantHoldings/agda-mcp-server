// MIT License — see LICENSE
//
// Reporting and introspection tools entry point. The individual tool
// registrations live in sibling files so this file is just an
// orchestrator — keeps the reporting surface easy to navigate and
// lets each tool's zod schema, description, and callback be read in
// isolation.
//
//   register-tools-catalog.ts  — agda_tools_catalog
//   register-protocol-parity.ts — agda_protocol_parity
//   register-bug-bundles.ts    — agda_bug_report_bundle + agda_bug_report_update_bundle
//
// Shared schemas and rendering helpers live in reporting-schemas.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../agda-process.js";

import { registerBugReportBundle, registerBugReportUpdateBundle } from "./register-bug-bundles.js";
import { registerGoalCatalog } from "./register-goal-catalog.js";
import { registerProtocolParity } from "./register-protocol-parity.js";
import { registerSessionSnapshot } from "./register-session-snapshot.js";
import { registerToolRecommend } from "./register-tool-recommend.js";
import { registerToolsCatalog } from "./register-tools-catalog.js";

export function register(
  server: McpServer,
  session: AgdaSession,
  _repoRoot: string,
): void {
  registerToolsCatalog(server, session);
  registerProtocolParity(server);
  registerBugReportBundle(server, session);
  registerBugReportUpdateBundle(server, session);
  registerSessionSnapshot(server, session, _repoRoot);
  registerGoalCatalog(server, session, _repoRoot);
  registerToolRecommend(server, session, _repoRoot);
}
