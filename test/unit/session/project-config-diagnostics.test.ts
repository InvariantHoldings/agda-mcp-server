import { test, expect } from "vitest";

import {
  prefixForWarningSource,
  projectConfigDiagnostics,
  projectConfigWarningsText,
} from "../../../src/session/project-config-diagnostics.js";
import type { ProjectConfigWarning } from "../../../src/session/project-config.js";

// ── prefixForWarningSource ───────────────────────────────────────────

test("prefixForWarningSource maps each source to its own label", () => {
  // Pinned to keep prefix labels stable — agents grep these strings.
  expect(prefixForWarningSource("file")).toBe("config");
  expect(prefixForWarningSource("env")).toBe("env");
  expect(prefixForWarningSource("system")).toBe("system");
});

// ── projectConfigDiagnostics ─────────────────────────────────────────

test("projectConfigDiagnostics returns [] for undefined / empty input", () => {
  expect(projectConfigDiagnostics(undefined)).toEqual([]);
  expect(projectConfigDiagnostics([])).toEqual([]);
});

test("projectConfigDiagnostics tags file warnings with config: prefix and project-config-file code", () => {
  const warnings: ProjectConfigWarning[] = [
    { source: "file", message: "bad thing", path: "/tmp/.agda-mcp.json" },
  ];
  const diags = projectConfigDiagnostics(warnings);
  expect(diags.length).toBe(1);
  expect(diags[0].code).toBe("project-config-file");
  expect(diags[0].message).toBe("config: bad thing");
});

test("projectConfigDiagnostics tags env warnings with env: prefix and project-config-env code", () => {
  const warnings: ProjectConfigWarning[] = [
    { source: "env", message: "bad env" },
  ];
  const diags = projectConfigDiagnostics(warnings);
  expect(diags[0].code).toBe("project-config-env");
  expect(diags[0].message).toBe("env: bad env");
});

test("projectConfigDiagnostics tags system warnings with system: prefix (not config:)", () => {
  // Regression: system-source warnings used to fall through the
  // env/config ternary and end up labeled `config:`, contradicting
  // the diagnostic's `project-config-system` kind.
  const warnings: ProjectConfigWarning[] = [
    { source: "system", message: "stat failed" },
  ];
  const diags = projectConfigDiagnostics(warnings);
  expect(diags[0].code).toBe("project-config-system");
  expect(diags[0].message).toBe("system: stat failed");
  expect(diags[0].message).not.toContain("config:");
});

test("projectConfigDiagnostics preserves order across mixed sources", () => {
  const warnings: ProjectConfigWarning[] = [
    { source: "file", message: "f1" },
    { source: "env", message: "e1" },
    { source: "system", message: "s1" },
    { source: "file", message: "f2" },
  ];
  const diags = projectConfigDiagnostics(warnings);
  expect(diags.map((d) => d.message)).toEqual([
    "config: f1",
    "env: e1",
    "system: s1",
    "config: f2",
  ]);
});

// ── projectConfigWarningsText ────────────────────────────────────────

test("projectConfigWarningsText returns empty string when no warnings", () => {
  expect(projectConfigWarningsText(undefined)).toBe("");
  expect(projectConfigWarningsText([])).toBe("");
});

test("projectConfigWarningsText includes one bullet per warning with the source bracket", () => {
  const warnings: ProjectConfigWarning[] = [
    { source: "file", message: "bad" },
    { source: "system", message: "broke" },
  ];
  const text = projectConfigWarningsText(warnings);
  expect(text).toContain("**Project-config warnings:**");
  expect(text).toContain("- [file] bad");
  expect(text).toContain("- [system] broke");
});
