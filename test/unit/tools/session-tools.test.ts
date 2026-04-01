import { test, expect } from "vitest";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../../../src/agda-process.js";
import { clearToolManifest, getToolManifestEntry, listToolManifest } from "../../../src/tools/manifest.js";
import { register as registerSessionTools } from "../../../src/tools/session.js";
import { register as registerReportingTools } from "../../../src/tools/reporting-tools.js";
import { availableSessionTools, renderLoadLikeText } from "../../../src/session/tool-presentation.js";
import { TEST_FIXTURE_PROJECT_ROOT } from "../../helpers/repo-root.js";

const projectRoot = TEST_FIXTURE_PROJECT_ROOT;

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

  expect(text).toMatch(/Classification:\*\* ok-with-holes/);
  expect(text).toMatch(/Goal IDs/);
  expect(text).toMatch(/\?\d/);
  expect(text).toMatch(/Warnings/);
});

test("session and reporting registrations populate manifest entries", () => {
  clearToolManifest();
  const server = createServer();
  const session = new AgdaSession(projectRoot);

  try {
    registerSessionTools(server, session, projectRoot);
    registerReportingTools(server, session, projectRoot);

    const loadEntry = getToolManifestEntry("agda_load");
    const statusEntry = getToolManifestEntry("agda_session_status");
    const catalogEntry = getToolManifestEntry("agda_tools_catalog");
    const parityEntry = getToolManifestEntry("agda_protocol_parity");
    const bugEntry = getToolManifestEntry("agda_bug_report_bundle");

    expect(loadEntry).toBeTruthy();
    expect(loadEntry.protocolCommands).toEqual(["Cmd_load", "Cmd_metas"]);
    expect(loadEntry.outputFields.includes("classification")).toBeTruthy();

    expect(statusEntry).toBeTruthy();
    expect(statusEntry.category).toBe("session");

    expect(catalogEntry).toBeTruthy();
    expect(catalogEntry.category).toBe("reporting");

    expect(parityEntry).toBeTruthy();
    expect(parityEntry.category).toBe("reporting");
    expect(parityEntry.outputFields.includes("endToEndCount")).toBeTruthy();
    expect(parityEntry.outputFields.includes("knownGapCount")).toBeTruthy();

    expect(bugEntry).toBeTruthy();
    expect(bugEntry.outputFields.includes("bugFingerprint")).toBeTruthy();
  } finally {
    session.destroy();
    clearToolManifest();
  }
});

test("availableSessionTools filters interactive tools when no file is loaded", () => {
  clearToolManifest();
  const server = createServer();
  const session = new AgdaSession(projectRoot);

  try {
    registerSessionTools(server, session, projectRoot);
    registerReportingTools(server, session, projectRoot);

    const unloaded = availableSessionTools(false).map((entry) => entry.name);
    const loaded = availableSessionTools(true).map((entry) => entry.name);

    expect(unloaded.includes("agda_load")).toBeTruthy();
    expect(unloaded.includes("agda_typecheck")).toBeTruthy();
    expect(!unloaded.includes("agda_goal_type")).toBeTruthy();
    expect(loaded.includes("agda_load")).toBeTruthy();
    expect(loaded.includes("agda_bug_report_bundle")).toBeTruthy();
    expect(loaded.length >= unloaded.length).toBeTruthy();
    expect(new Set(listToolManifest().map((entry) => entry.name)).size).toBe(listToolManifest().length);
  } finally {
    session.destroy();
    clearToolManifest();
  }
});
