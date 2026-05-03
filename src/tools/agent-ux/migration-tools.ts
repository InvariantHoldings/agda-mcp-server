// MIT License — see LICENSE
//
// Migration-aware reporting and verification tools.
//
// These tools wrap two static curated maps:
//   - STDLIB_MIGRATION_MAP: cross-version stdlib renames (proj1 → proj₁ etc.).
//   - BUILTIN_MIGRATION_MAP: builtin name → module + cross-version status.
//
// They exist so an agent can ask "what's the canonical name in this
// version?" without re-deriving the mapping from scratch every session.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
  warningDiagnostic,
} from "../tool-helpers.js";

interface StdlibMigrationEntry {
  fromVersion: string;
  toVersion: string;
  from: string;
  to: string;
}

interface BuiltinMigrationEntry {
  name: string;
  module: string;
  renamedFrom?: string;
  removedIn?: string;
  replacement?: string;
}

const STDLIB_MIGRATION_MAP: ReadonlyArray<StdlibMigrationEntry> = [
  { fromVersion: "1.7", toVersion: "2.0", from: "proj1", to: "proj₁" },
  { fromVersion: "1.7", toVersion: "2.0", from: "proj2", to: "proj₂" },
  { fromVersion: "1.7", toVersion: "2.0", from: "_,_", to: "_,_" },
  { fromVersion: "2.0", toVersion: "2.1", from: "Data.Nat.Properties.≤-refl", to: "Data.Nat.Properties.≤-refl" },
];

const BUILTIN_MIGRATION_MAP: ReadonlyArray<BuiltinMigrationEntry> = [
  { name: "Nat", module: "Agda.Builtin.Nat" },
  { name: "List", module: "Agda.Builtin.List" },
  { name: "Bool", module: "Agda.Builtin.Bool" },
  { name: "Sigma", module: "Agda.Builtin.Sigma", renamedFrom: "Σ" },
  { name: "IO", module: "Agda.Builtin.IO" },
  { name: "Word64", module: "Agda.Builtin.Word", removedIn: "2.9.0", replacement: "Data.Word.Word64" },
];

export function registerMigrationTools(server: McpServer, _repoRoot: string): void {
  registerStructuredTool({
    server,
    name: "agda_stdlib_migration_map",
    description: "Return the curated stdlib rename map keyed by source and target versions. Use this before applying mechanical rename repairs.",
    category: "reporting",
    inputSchema: {
      fromVersion: z.string().optional().describe("Optional source stdlib version filter"),
      toVersion: z.string().optional().describe("Optional destination stdlib version filter"),
      symbol: z.string().optional().describe("Optional symbol filter (matches either source or destination name)"),
    },
    outputDataSchema: z.object({
      entries: z.array(z.object({
        fromVersion: z.string(),
        toVersion: z.string(),
        from: z.string(),
        to: z.string(),
      })),
      count: z.number(),
    }),
    callback: async ({ fromVersion, toVersion, symbol }: { fromVersion?: string; toVersion?: string; symbol?: string }) => {
      const filtered = STDLIB_MIGRATION_MAP.filter((entry) => {
        if (fromVersion && entry.fromVersion !== fromVersion) return false;
        if (toVersion && entry.toVersion !== toVersion) return false;
        if (symbol && !(entry.from.includes(symbol) || entry.to.includes(symbol))) return false;
        return true;
      });
      const text = filtered.length === 0
        ? "No stdlib migration entries matched the filter."
        : filtered.map((entry) => `- ${entry.fromVersion} → ${entry.toVersion}: \`${entry.from}\` → \`${entry.to}\``).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_stdlib_migration_map",
          summary: `Found ${filtered.length} stdlib migration entr${filtered.length === 1 ? "y" : "ies"}.`,
          data: { entries: filtered, count: filtered.length },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_builtin_migration_map",
    description: "Return curated builtin rename/removal records across Agda versions.",
    category: "reporting",
    inputSchema: {
      name: z.string().optional().describe("Optional builtin name filter"),
    },
    outputDataSchema: z.object({
      entries: z.array(z.object({
        name: z.string(),
        module: z.string(),
        renamedFrom: z.string().optional(),
        removedIn: z.string().optional(),
        replacement: z.string().optional(),
      })),
      count: z.number(),
    }),
    callback: async ({ name }: { name?: string }) => {
      const filtered = name
        ? BUILTIN_MIGRATION_MAP.filter((entry) => entry.name === name || entry.renamedFrom === name)
        : [...BUILTIN_MIGRATION_MAP];
      const text = filtered.length === 0
        ? "No builtin migration records matched the filter."
        : filtered
          .map((entry) => {
            const details: string[] = [];
            if (entry.renamedFrom) details.push(`renamed from ${entry.renamedFrom}`);
            if (entry.removedIn) details.push(`removed in ${entry.removedIn}`);
            if (entry.replacement) details.push(`replacement ${entry.replacement}`);
            return `- ${entry.name} (${entry.module})${details.length > 0 ? ` — ${details.join(", ")}` : ""}`;
          })
          .join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_builtin_migration_map",
          summary: `Found ${filtered.length} builtin migration entr${filtered.length === 1 ? "y" : "ies"}.`,
          data: { entries: filtered, count: filtered.length },
        }),
        text,
      );
    },
  });

  registerStructuredTool({
    server,
    name: "agda_verify_builtin",
    description: "Given a builtin name, report whether it is resolvable from the curated builtin map and provide migration hints.",
    category: "analysis",
    inputSchema: {
      name: z.string().describe("Builtin name, e.g. Nat, Sigma, IO"),
      options: z.object({
        agdaVersion: z.string().optional(),
      }).optional(),
    },
    outputDataSchema: z.object({
      name: z.string(),
      resolvable: z.boolean(),
      module: z.string().nullable(),
      hints: z.array(z.string()),
    }),
    callback: async ({ name }: { name: string }) => {
      const match = BUILTIN_MIGRATION_MAP.find((entry) => entry.name === name || entry.renamedFrom === name);
      const hints: string[] = [];
      if (match?.renamedFrom && match.renamedFrom === name) {
        hints.push(`Renamed builtin: use ${match.name}`);
      }
      if (match?.removedIn && match.replacement) {
        hints.push(`Builtin removed in ${match.removedIn}; use ${match.replacement}`);
      }
      if (!match) {
        hints.push("No curated builtin match; verify with Agda version docs.");
      }
      return makeToolResult(
        okEnvelope({
          tool: "agda_verify_builtin",
          summary: match ? `${name} resolves via ${match.module}.` : `${name} was not found in the curated builtin map.`,
          classification: match ? "ok" : "unknown-builtin",
          data: {
            name,
            resolvable: Boolean(match && !match.removedIn),
            module: match?.module ?? null,
            hints,
          },
          diagnostics: hints.map((hint) => warningDiagnostic(hint, "builtin-migration")),
        }),
      );
    },
  });
}
