#!/usr/bin/env node
//
// agda-mcp-server — Stateful MCP server for Agda proof interaction
//
// Maintains a persistent Agda session using --interaction-json mode.
// After loading a file, goals (interaction points) are assigned IDs
// that persist for interactive commands: case-split, refine, give,
// auto-solve, normalize, infer, elaborate, and more.
//
// Architecture:
//   src/agda-process.ts     — Agda subprocess manager (IOTCM protocol)
//   src/tools/session.ts    — agda_load, agda_session_status, agda_typecheck
//   src/tools/proof.ts      — goal types, case split, give, refine, auto, etc.
//   src/tools/navigation.ts — read module, list modules, search, why-in-scope
//   external modules        — Optional extensions loaded via environment variable

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgdaSession } from "./agda-process.js";
import { getServerVersion } from "./server-version.js";

import { register as registerSession } from "./tools/session.js";
import { register as registerGoalTools } from "./tools/goal-tools.js";
import { register as registerExpressionTools } from "./tools/expression-tools.js";
import { register as registerQueryTools } from "./tools/query-tools.js";
import { register as registerFileTools } from "./tools/file-tools.js";
import { register as registerScopeTools } from "./tools/scope-tools.js";
import { register as registerDisplay } from "./tools/display.js";
import { register as registerBackend } from "./tools/backend.js";
import { register as registerAnalysis } from "./tools/analysis-tools.js";
import { register as registerReporting } from "./tools/reporting-tools.js";

type ExtensionRegister = (
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
) => void | Promise<void>;

const REPO_ROOT = process.env.AGDA_MCP_ROOT ?? process.cwd();

// Single shared session — Agda is stateful, one file at a time
const session = new AgdaSession(REPO_ROOT);

const server = new McpServer({
  name: "agda-mcp-server",
  version: getServerVersion(),
});

// ── Core tools (generic Agda) ──────────────────────────────────────
registerSession(server, session, REPO_ROOT);
registerGoalTools(server, session, REPO_ROOT);
registerExpressionTools(server, session, REPO_ROOT);
registerQueryTools(server, session, REPO_ROOT);
registerFileTools(server, session, REPO_ROOT);
registerScopeTools(server, session, REPO_ROOT);
registerDisplay(server, session, REPO_ROOT);
registerBackend(server, session, REPO_ROOT);
registerAnalysis(server, session, REPO_ROOT);
registerReporting(server, session, REPO_ROOT);

function resolveExtensionSpecifier(modulePath: string): string {
  if (modulePath.startsWith("file://")) {
    return modulePath;
  }

  const filesystemPath = isAbsolute(modulePath)
    ? modulePath
    : resolve(REPO_ROOT, modulePath);

  if (existsSync(filesystemPath)) {
    return pathToFileURL(filesystemPath).href;
  }

  return modulePath;
}

function collectRegisterFunctions(
  extensionModule: Record<string, unknown>,
): Array<[string, ExtensionRegister]> {
  function isRegisterEntry(
    entry: [string, unknown],
  ): entry is [string, ExtensionRegister] {
    const [name, value] = entry;
    return typeof value === "function"
      && (name === "register" || name.startsWith("register"));
  }

  return Object.entries(extensionModule)
    .filter(isRegisterEntry)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));
}

async function loadExternalExtensions(): Promise<void> {
  const modulePaths = (process.env.AGDA_MCP_EXTENSION_MODULES ?? "")
    .split(":")
    .map((modulePath) => modulePath.trim())
    .filter(Boolean);

  for (const modulePath of modulePaths) {
    const extensionModule = await import(resolveExtensionSpecifier(modulePath));
    const registerFunctions = collectRegisterFunctions(extensionModule);

    if (registerFunctions.length === 0) {
      console.warn(
        `Skipping extension module without register exports: ${modulePath}`,
      );
      continue;
    }

    for (const [, register] of registerFunctions) {
      await register(server, session, REPO_ROOT);
    }
  }
}

// ── Start server ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  await loadExternalExtensions();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Agda MCP server failed to start:", err);
  process.exit(1);
});

// Clean up on exit
process.on("SIGINT", () => { session.destroy(); process.exit(0); });
process.on("SIGTERM", () => { session.destroy(); process.exit(0); });

// ── Public API (for programmatic embedding) ────────────────────────
export { AgdaSession } from "./agda-process.js";
export type { AgdaResponse, AgdaGoal, LoadResult, GoalInfo } from "./agda-process.js";
export type { ExtensionRegister };
export { server, session, REPO_ROOT };
