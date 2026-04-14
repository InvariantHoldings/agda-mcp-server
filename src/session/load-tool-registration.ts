// MIT License — see LICENSE
//
// Load-oriented session tool registration entry point.
//
// registerSessionLoadTools installs agda_load, agda_load_no_metas,
// and agda_typecheck on the MCP server. The three tool implementations
// live in their own files (register-agda-load.ts,
// register-agda-load-no-metas.ts, register-agda-typecheck.ts) so each
// can evolve independently; this entry point just wires them together
// with a shared path resolver. Shared error-envelope helpers and
// profile-option validation live in load-tool-shared.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../agda-process.js";
import { resolveFileWithinRoot } from "../repo-root.js";

import type { PathResolver } from "./load-tool-shared.js";
import { registerAgdaLoad } from "./register-agda-load.js";
import { registerAgdaLoadNoMetas } from "./register-agda-load-no-metas.js";
import { registerAgdaTypecheck } from "./register-agda-typecheck.js";
import { registerAgdaApplyEdit } from "./register-agda-apply-edit.js";

export function registerSessionLoadTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
  options: {
    resolveInputFile?: PathResolver;
  } = {},
): void {
  const resolveInputFile = options.resolveInputFile ?? resolveFileWithinRoot;

  registerAgdaLoad(server, session, repoRoot, resolveInputFile);
  registerAgdaLoadNoMetas(server, session, repoRoot, resolveInputFile);
  registerAgdaTypecheck(server, session, repoRoot, resolveInputFile);
  registerAgdaApplyEdit(server, session, repoRoot);
}
