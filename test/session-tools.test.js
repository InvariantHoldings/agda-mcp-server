import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../dist/agda-process.js";
import { clearToolManifest, getToolManifestEntry, listToolManifest } from "../dist/tools/manifest.js";
import { register as registerSessionTools } from "../dist/tools/session.js";
import { register as registerReportingTools } from "../dist/tools/reporting-tools.js";
import { availableSessionTools, renderLoadLikeText } from "../dist/session/tool-presentation.js";

const repoRoot = resolve(import.meta.dirname, "fixtures/agda");

function createServer() {
  return new McpServer({
    name: "test-server",
    version: "0.0.0-test",
  });
}

test("renderLoadLikeText includes completeness and goal metadata", () => {
  const text = renderLoadLikeText({
    heading: "Loaded",
    file: "Example.agda",
    success: true,
    classification: "ok-with-holes",
    goalIds: [1, 2],
    goalCount: 2,
    invisibleGoalCount: 1,
    errors: [],
    warnings: ["warning text"],
    reloaded: true,
    staleBeforeLoad: false,
    extraLead: "**Reloading modified file.**",
  });

  assert.match(text, /Classification:\*\* ok-with-holes/);
  assert.match(text, /Goal IDs/);
  assert.match(text, /\?\d/);
  assert.match(text, /Warnings/);
});

test("session and reporting registrations populate manifest entries", () => {
  clearToolManifest();
  const server = createServer();
  const session = new AgdaSession(repoRoot);

  try {
    registerSessionTools(server, session, repoRoot);
    registerReportingTools(server, session, repoRoot);

    const loadEntry = getToolManifestEntry("agda_load");
    const statusEntry = getToolManifestEntry("agda_session_status");
    const catalogEntry = getToolManifestEntry("agda_tools_catalog");
    const parityEntry = getToolManifestEntry("agda_protocol_parity");
    const bugEntry = getToolManifestEntry("agda_bug_report_bundle");

    assert.ok(loadEntry);
    assert.deepEqual(loadEntry.protocolCommands, ["Cmd_load", "Cmd_metas"]);
    assert.ok(loadEntry.outputFields.includes("classification"));

    assert.ok(statusEntry);
    assert.equal(statusEntry.category, "session");

    assert.ok(catalogEntry);
    assert.equal(catalogEntry.category, "reporting");

    assert.ok(parityEntry);
    assert.equal(parityEntry.category, "reporting");
    assert.ok(parityEntry.outputFields.includes("knownGapCount"));

    assert.ok(bugEntry);
    assert.ok(bugEntry.outputFields.includes("bugFingerprint"));
  } finally {
    session.destroy();
    clearToolManifest();
  }
});

test("availableSessionTools filters interactive tools when no file is loaded", () => {
  clearToolManifest();
  const server = createServer();
  const session = new AgdaSession(repoRoot);

  try {
    registerSessionTools(server, session, repoRoot);
    registerReportingTools(server, session, repoRoot);

    const unloaded = availableSessionTools(false).map((entry) => entry.name);
    const loaded = availableSessionTools(true).map((entry) => entry.name);

    assert.ok(unloaded.includes("agda_load"));
    assert.ok(unloaded.includes("agda_typecheck"));
    assert.ok(!unloaded.includes("agda_goal_type"));
    assert.ok(loaded.includes("agda_load"));
    assert.ok(loaded.includes("agda_bug_report_bundle"));
    assert.ok(loaded.length >= unloaded.length);
    assert.equal(new Set(listToolManifest().map((entry) => entry.name)).size, listToolManifest().length);
  } finally {
    session.destroy();
    clearToolManifest();
  }
});
