import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function filterStringEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter((entry) => typeof entry[1] === "string"),
  );
}

export function buildHarnessServerParameters({
  repoRoot,
  projectRoot = repoRoot,
  extraEnv = {},
} = {}) {
  if (!repoRoot) {
    throw new Error("repoRoot is required");
  }

  return {
    command: process.execPath,
    args: [resolve(repoRoot, "dist/index.js")],
    cwd: repoRoot,
    env: filterStringEnv({
      ...process.env,
      ...extraEnv,
      AGDA_MCP_ROOT: projectRoot,
    }),
    stderr: "pipe",
  };
}

export async function createMcpHarness({
  repoRoot,
  projectRoot = repoRoot,
  extraEnv = {},
  clientInfo = { name: "agda-mcp-harness", version: "0.0.0" },
} = {}) {
  const client = new Client(clientInfo);
  const transport = new StdioClientTransport(
    buildHarnessServerParameters({ repoRoot, projectRoot, extraEnv }),
  );

  let stderr = "";
  const stderrStream = transport.stderr;
  if (stderrStream) {
    stderrStream.on("data", (chunk) => {
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
    async callTool(name, args = {}) {
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
