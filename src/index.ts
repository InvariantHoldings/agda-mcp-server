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
import { PROJECT_ROOT, SERVER_REPO_ROOT, resolveProjectPath } from "./repo-root.js";
import { getServerVersion } from "./server-version.js";

import { registerCoreTools } from "./tools/register-core-tools.js";

type ExtensionRegister = (
  server: McpServer,
  session: AgdaSession,
  projectRoot: string,
) => void | Promise<void>;

// Single shared session — Agda is stateful, one file at a time
const session = new AgdaSession(PROJECT_ROOT);

const server = new McpServer({
  name: "agda-mcp-server",
  version: getServerVersion(),
});

// ── Core tools (generic Agda) ──────────────────────────────────────
registerCoreTools(server, session, PROJECT_ROOT);

function resolveExtensionSpecifier(modulePath: string): string {
  if (modulePath.startsWith("file://")) {
    return modulePath;
  }

  const filesystemPath = resolveProjectPath(PROJECT_ROOT, modulePath);

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
      await register(server, session, PROJECT_ROOT);
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
export { server, session, PROJECT_ROOT, SERVER_REPO_ROOT };
