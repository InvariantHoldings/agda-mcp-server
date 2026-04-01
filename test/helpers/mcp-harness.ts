import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function filterStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

interface HarnessOptions {
  serverRepoRoot?: string;
  repoRoot?: string;
  projectRoot?: string;
  extraEnv?: Record<string, string>;
  clientInfo?: { name: string; version: string };
}

export function buildHarnessServerParameters({
  serverRepoRoot,
  repoRoot = serverRepoRoot,
  projectRoot = repoRoot ?? serverRepoRoot,
  extraEnv = {},
}: HarnessOptions = {}) {
  const effectiveServerRepoRoot = repoRoot ?? serverRepoRoot;

  if (!effectiveServerRepoRoot) {
    throw new Error("serverRepoRoot is required");
  }

  return {
    command: process.execPath,
    args: [resolve(effectiveServerRepoRoot, "dist/index.js")],
    cwd: effectiveServerRepoRoot,
    env: filterStringEnv({
      ...process.env,
      ...extraEnv,
      AGDA_MCP_ROOT: projectRoot,
    }),
    stderr: "pipe" as const,
  };
}

export async function createMcpHarness({
  serverRepoRoot,
  repoRoot = serverRepoRoot,
  projectRoot = repoRoot ?? serverRepoRoot,
  extraEnv = {},
  clientInfo = { name: "agda-mcp-harness", version: "0.0.0" },
}: HarnessOptions = {}) {
  const client = new Client(clientInfo);
  const transport = new StdioClientTransport(
    buildHarnessServerParameters({
      serverRepoRoot: repoRoot ?? serverRepoRoot,
      projectRoot,
      extraEnv,
    }),
  );

  let stderr = "";
  const stderrStream = transport.stderr;
  if (stderrStream) {
    stderrStream.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
  }

  client.onerror = (error) => {
    stderr += `${error instanceof Error ? error.message : String(error)}\n`;
  };

  await client.connect(transport);

  return {
    client,
    transport,
    async listTools() {
      return client.listTools();
    },
    async callTool(name: string, args: Record<string, unknown> = {}) {
      return client.callTool({ name, arguments: args });
    },
    getServerVersion() {
      return client.getServerVersion();
    },
    getServerCapabilities() {
      return client.getServerCapabilities();
    },
    getStderr() {
      return stderr;
    },
    async close() {
      await transport.close();
    },
  };
}
