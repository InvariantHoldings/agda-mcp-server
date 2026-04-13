// MIT License — see LICENSE
//
// Shared schemas and renderers for session-oriented tools.

import { z } from "zod";

import { listToolManifest, type ToolCategory } from "../tools/manifest.js";

export const loadDataSchema = z.object({
  file: z.string(),
  success: z.boolean(),
  goalIds: z.array(z.number()),
  goalCount: z.number(),
  invisibleGoalCount: z.number(),
  hasHoles: z.boolean(),
  isComplete: z.boolean(),
  classification: z.string(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  reloaded: z.boolean(),
  staleBeforeLoad: z.boolean(),
  previousClassification: z.string().nullable().optional(),
  previousLoadedAtMs: z.number().nullable().optional(),
});

export const sessionStatusDataSchema = z.object({
  phase: z.string(),
  loadedFile: z.string().nullable(),
  goalIds: z.array(z.number()),
  availableTools: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      description: z.string(),
    }),
  ),
});

export const versionDataSchema = z.object({
  version: z.string(),
});

export const processCommandDataSchema = z.object({
  command: z.enum(["abort", "exit"]),
  delivered: z.boolean(),
});

export const typecheckDataSchema = z.object({
  file: z.string(),
  success: z.boolean(),
  goalIds: z.array(z.number()),
  goalCount: z.number(),
  invisibleGoalCount: z.number(),
  hasHoles: z.boolean(),
  isComplete: z.boolean(),
  classification: z.string(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export function renderDiagnosticsSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  let output = `### ${title}\n`;
  for (const item of items) {
    output += `\`\`\`\n${item}\n\`\`\`\n`;
  }
  return output;
}

export function renderLoadLikeText(args: {
  heading: string;
  file: string;
  success: boolean;
  classification: string;
  goalIds: number[];
  goalCount: number;
  invisibleGoalCount: number;
  errors: string[];
  warnings: string[];
  reloaded?: boolean;
  staleBeforeLoad?: boolean;
  extraLead?: string;
}): string {
  let output = "";

  if (args.extraLead) {
    output += `${args.extraLead}\n\n`;
  }

  output += `## ${args.heading}: ${args.file}\n\n`;
  output += `**Status:** ${args.success ? "OK" : "FAILED"}\n`;
  output += `**Classification:** ${args.classification}\n`;
  output += `**Goals:** ${args.goalCount} unsolved\n`;
  if (args.invisibleGoalCount > 0) {
    output += `**Invisible goals:** ${args.invisibleGoalCount}\n`;
  }
  if (args.reloaded !== undefined) {
    output += `**Reloaded:** ${args.reloaded ? "yes" : "no"}\n`;
  }
  if (args.staleBeforeLoad !== undefined) {
    output += `**Stale before load:** ${args.staleBeforeLoad ? "yes" : "no"}\n`;
  }
  output += "\n";

  output += renderDiagnosticsSection("Errors", args.errors);
  output += renderDiagnosticsSection("Warnings", args.warnings);

  if (args.goalIds.length > 0) {
    output += "### Goal IDs\n";
    output += "Use these IDs with proof tools such as `agda_goal_type`, `agda_refine`, `agda_give`, and `agda_auto`.\n\n";
    for (const goalId of args.goalIds) {
      output += `- **?${goalId}**\n`;
    }
  }

  return output;
}

export function availableSessionTools(
  loaded: boolean,
): Array<{ name: string; category: ToolCategory; description: string }> {
  const manifest = listToolManifest();
  return manifest
    .filter((entry) => {
      if (entry.name === "agda_session_status") {
        return true;
      }

      if (entry.name === "agda_load" || entry.name === "agda_load_no_metas" || entry.name === "agda_typecheck") {
        return true;
      }

      return loaded;
    })
    .map((entry) => ({
      name: entry.name,
      category: entry.category,
      description: entry.description,
    }));
}
