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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AgdaSession, findAgdaBinary } from "./agda-process.js";
import { PROJECT_ROOT, SERVER_REPO_ROOT, resolveProjectPath } from "./repo-root.js";
import { getServerVersion } from "./server-version.js";

import { registerCoreTools } from "./tools/register-core-tools.js";
import { registerGlobalProvenance } from "./tools/tool-helpers.js";

type ExtensionRegister = (
  server: McpServer,
  session: AgdaSession,
  projectRoot: string,
) => void | Promise<void>;

// Single shared session — the authoritative source of truth for Agda
// session state in the running server. Every load-family tool
// (agda_load, agda_load_no_metas, agda_typecheck, ...) MUST route
// through this instance so currentFile, lastLoadedMtime, goalIds, and
// the repo's _build/ interface state stay coherent across tool calls.
// A second, parallel AgdaSession would share _build/ on disk but not
// its session state, leaving tools with divergent views of what is
// loaded. See issue #39 for the concrete regression this invariant
// fixes.
const session = new AgdaSession(PROJECT_ROOT);

// Stamp the server version and (best-effort) the Agda version into every
// tool response's provenance block. Agents repeatedly need to know which
// toolchain produced a given response — without this stamp they either
// re-call agda_show_version per tool use or infer from context. Version
// capture is best-effort: if `agda --version` fails, the provenance
// entry is simply omitted so tools continue to work.
//
// SECURITY: we use execFileSync, not execSync, because agdaBin is derived
// from PROJECT_ROOT which is derived from the AGDA_MCP_ROOT env var (and
// can also be the AGDA_BIN env var directly). execSync's string form runs
// the command through `/bin/sh -c`, which would interpret any shell
// metacharacter in an attacker-controlled env var as a command separator
// (CVE class: CWE-78). execFileSync calls execvp() on the raw path with
// the args array, so the shell is never involved and no metacharacter
// interpretation occurs. The `shell: false` option is the default and is
// passed explicitly as belt-and-suspenders to prevent a future maintainer
// from re-enabling shell semantics.
registerGlobalProvenance("serverVersion", getServerVersion());
try {
  const agdaBin = findAgdaBinary(PROJECT_ROOT);
  const rawVersion = execFileSync(agdaBin, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    shell: false,
  });
  const firstLine = rawVersion.split(/\r?\n/u)[0]?.trim();
  if (firstLine) {
    registerGlobalProvenance("agdaVersion", firstLine);
  }
} catch {
  // Agda not reachable from the spawn point — skip the provenance stamp.
  // The server will still run (e.g. in harness tests that don't need
  // Agda, or when the binary is discovered later via AGDA_BIN).
}

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
