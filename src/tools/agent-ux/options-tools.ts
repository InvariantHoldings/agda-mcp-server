// MIT License — see LICENSE
//
// Options / project-config introspection. Lets an agent see which Agda
// flags will apply to a load — broken down by source — without first
// running a load.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";

import type { AgdaSession } from "../../agda-process.js";
import {
  parseAgdaLibFlags,
  parseOptionsPragmas,
} from "../../agda/agent-ux.js";
import { createLibraryRegistration } from "../../agda/library-registration.js";
import { filePathDescription } from "../../agda/version-support.js";
import { resolveExistingPathWithinRoot, resolveFileWithinRoot } from "../../repo-root.js";
import {
  effectiveProjectFlags,
  ENV_DEFAULT_FLAGS,
  PROJECT_CONFIG_FILENAME,
  loadProjectConfig,
  mergeCommandLineOptions,
} from "../../session/project-config.js";
import { projectConfigDiagnostics } from "../../session/project-config-diagnostics.js";
import {
  makeToolResult,
  okEnvelope,
  registerStructuredTool,
} from "../tool-helpers.js";

export function registerOptionsTools(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  registerStructuredTool({
    server,
    name: "agda_effective_options",
    description: "Return effective Agda options for a file with source attribution (OPTIONS pragma, .agda-lib flags, wrapper hints, and MCP defaults).",
    category: "analysis",
    inputSchema: {
      file: z.string().describe(filePathDescription(session.getAgdaVersion() ?? undefined)),
    },
    outputDataSchema: z.object({
      file: z.string(),
      options: z.array(z.object({
        option: z.string(),
        source: z.enum(["file-pragma", "agda-lib", "wrapper-script", "mcp-default", "project-config", "env-var"]),
      })),
      deduplicated: z.array(z.string()),
    }),
    callback: async ({ file }: { file: string }) => {
      const filePath = resolveExistingPathWithinRoot(repoRoot, resolveFileWithinRoot(repoRoot, file));
      const source = readFileSync(filePath, "utf8");
      const options: Array<{ option: string; source: "file-pragma" | "agda-lib" | "wrapper-script" | "mcp-default" | "project-config" | "env-var" }> = [];
      for (const opt of parseOptionsPragmas(source)) {
        options.push({ option: opt, source: "file-pragma" });
      }

      const repoEntries = readdirSync(repoRoot, { withFileTypes: true });
      for (const entry of repoEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".agda-lib")) continue;
        const libText = readFileSync(resolve(repoRoot, entry.name), "utf8");
        for (const flag of parseAgdaLibFlags(libText)) {
          options.push({ option: flag, source: "agda-lib" });
        }
      }

      // Report project config file flags and env var flags separately.
      // Sources are pre-partitioned by `loadProjectConfig`, so a flag
      // present in BOTH `.agda-mcp.json` and AGDA_MCP_DEFAULT_FLAGS shows
      // up once per source rather than being misattributed.
      const projectConfig = loadProjectConfig(repoRoot);
      for (const opt of projectConfig.fileFlags) {
        options.push({ option: opt, source: "project-config" });
      }
      for (const opt of projectConfig.envFlags) {
        options.push({ option: opt, source: "env-var" });
      }

      const agdaBin = process.env.AGDA_BIN;
      if (agdaBin && existsSync(agdaBin)) {
        const scriptText = readFileSync(agdaBin, "utf8");
        const discovered = scriptText.match(/--[A-Za-z0-9-]+/gu) ?? [];
        for (const flag of discovered) {
          options.push({ option: flag, source: "wrapper-script" });
        }
      }

      options.push({ option: "--interaction-json", source: "mcp-default" });
      const registration = createLibraryRegistration(repoRoot);
      try {
        for (const opt of registration.agdaArgs) {
          options.push({ option: opt, source: "mcp-default" });
        }
      } finally {
        registration.cleanup();
      }

      const deduplicated = [...new Set(options.map((entry) => entry.option))];
      const text = options.map((entry) => `- ${entry.option} (${entry.source})`).join("\n");
      return makeToolResult(
        okEnvelope({
          tool: "agda_effective_options",
          summary: `Resolved ${deduplicated.length} effective option(s).`,
          data: {
            file: relative(repoRoot, filePath),
            options,
            deduplicated,
          },
        }),
        text,
      );
    },
  });

  // agda_project_config — diagnose `.agda-mcp.json` and AGDA_MCP_DEFAULT_FLAGS
  // without forcing a load. When a load fails because of a typoed key or
  // flag, the warnings on the load response already explain why; this
  // tool lets an agent inspect the resolved config in isolation.
  registerStructuredTool({
    server,
    name: "agda_project_config",
    description:
      "Inspect the resolved project-level Agda configuration (.agda-mcp.json + AGDA_MCP_DEFAULT_FLAGS) " +
      "with provenance and validation warnings. Use this when an agent wants to confirm which compiler " +
      "flags will be applied to subsequent agda_load / agda_typecheck calls before running them.",
    category: "analysis",
    inputSchema: {},
    outputDataSchema: z.object({
      configFilePath: z.string().nullable(),
      configFileExists: z.boolean(),
      envVarName: z.string(),
      envVarSet: z.boolean(),
      fileFlags: z.array(z.string()),
      envFlags: z.array(z.string()),
      effectiveFlags: z.array(z.string()),
      warnings: z.array(z.object({
        source: z.enum(["file", "env", "system"]),
        message: z.string(),
        path: z.string().optional(),
      })),
    }),
    callback: async () => {
      const projectConfig = loadProjectConfig(repoRoot);
      const configFilePath = projectConfig.configFilePath ?? null;
      const configFileExists = configFilePath !== null && existsSync(configFilePath);
      const envVarRaw = process.env[ENV_DEFAULT_FLAGS];
      // `envVarSet` should mirror the *effective* state, so a value of
      // "   " or "\t\n" — which `parseEnvFlags()` resolves to zero
      // flags — is reported as unset. Otherwise an agent inspecting the
      // config sees `envVarSet: true` while `envFlags` is empty, which
      // looks contradictory.
      const envVarSet = envVarRaw !== undefined && envVarRaw.trim().length > 0;

      // Effective flags must match what `AgdaSession.load()` would
      // produce given a no-per-call call site, so route through the
      // same `effectiveProjectFlags` + `mergeCommandLineOptions`
      // pipeline. (Per-call options live on the tool call itself and
      // aren't visible at config time, so we pass `[]`.)
      const effectiveFlags = mergeCommandLineOptions(
        effectiveProjectFlags(projectConfig),
        [],
      );

      const data = {
        configFilePath: configFilePath ? relative(repoRoot, configFilePath) : null,
        configFileExists,
        envVarName: ENV_DEFAULT_FLAGS,
        envVarSet,
        fileFlags: projectConfig.fileFlags,
        envFlags: projectConfig.envFlags,
        effectiveFlags,
        warnings: projectConfig.warnings,
      };

      const lines: string[] = [
        `${PROJECT_CONFIG_FILENAME}: ${
          configFileExists
            ? `present (${data.configFilePath})`
            : "not present"
        }`,
        `${ENV_DEFAULT_FLAGS}: ${envVarSet ? "set" : "unset"}`,
        projectConfig.fileFlags.length > 0
          ? `File flags: ${projectConfig.fileFlags.join(" ")}`
          : "File flags: (none)",
        projectConfig.envFlags.length > 0
          ? `Env flags: ${projectConfig.envFlags.join(" ")}`
          : "Env flags: (none)",
        effectiveFlags.length > 0
          ? `Effective flags (deduplicated): ${effectiveFlags.join(" ")}`
          : "Effective flags: (none)",
      ];
      if (projectConfig.warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const w of projectConfig.warnings) {
          lines.push(`- [${w.source}] ${w.message}`);
        }
      }

      const summary = projectConfig.warnings.length === 0
        ? `Resolved ${effectiveFlags.length} effective project flag(s).`
        : `Resolved ${effectiveFlags.length} effective project flag(s) with ${projectConfig.warnings.length} warning(s).`;

      return makeToolResult(
        okEnvelope({
          tool: "agda_project_config",
          summary,
          data,
          diagnostics: projectConfigDiagnostics(projectConfig.warnings),
        }),
        lines.join("\n"),
      );
    },
  });
}
