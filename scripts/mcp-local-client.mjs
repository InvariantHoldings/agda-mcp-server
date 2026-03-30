#!/usr/bin/env node

import { resolve } from "node:path";

import { createMcpHarness } from "../test/helpers/mcp-harness.js";

function usage() {
  console.error(`Usage:
  node scripts/mcp-local-client.mjs list-tools [project-root]
  node scripts/mcp-local-client.mjs call-tool <tool-name> [json-args] [project-root]
  node scripts/mcp-local-client.mjs server-info [project-root]

Examples:
  node scripts/mcp-local-client.mjs list-tools
  node scripts/mcp-local-client.mjs call-tool agda_load '{"file":"test/fixtures/agda/WithHoles.agda"}'
  node scripts/mcp-local-client.mjs call-tool agda_tools_catalog '{}'
`);
}

function parseJsonObject(raw) {
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("tool arguments must be a JSON object");
  }

  return parsed;
}

async function main() {
  const repoRoot = process.cwd();
  const [command, firstArg, secondArg] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exit(1);
  }

  let projectRoot = repoRoot;
  let action = command;
  let toolName;
  let toolArgs = {};

  if (action === "list-tools" || action === "server-info") {
    if (firstArg) {
      projectRoot = resolve(repoRoot, firstArg);
    }
  } else if (action === "call-tool") {
    if (!firstArg) {
      usage();
      process.exit(1);
    }

    toolName = firstArg;
    toolArgs = parseJsonObject(secondArg);

    if (process.argv[5]) {
      projectRoot = resolve(repoRoot, process.argv[5]);
    }
  } else {
    usage();
    process.exit(1);
  }

  const harness = await createMcpHarness({
    repoRoot,
    projectRoot,
  });

  try {
    if (action === "list-tools") {
      const result = await harness.listTools();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (action === "server-info") {
      console.log(JSON.stringify({
        serverVersion: harness.getServerVersion(),
        serverCapabilities: harness.getServerCapabilities(),
      }, null, 2));
      return;
    }

    const result = await harness.callTool(toolName, toolArgs);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await harness.close();
    const stderr = harness.getStderr().trim();
    if (stderr) {
      console.error("\n[server stderr]");
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
