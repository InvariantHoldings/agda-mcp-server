// MIT License — see LICENSE
//
// Goal catalog domain logic.
//
// Builds a structured catalog of all goals in the current proof state,
// including types, context summaries, and per-goal suggestions.
// Pure functions for testability — no side effects.

import {
  parseContextEntry,
  deriveSuggestions,
  type ContextEntry,
  type Suggestion,
} from "../agda/goal-analysis.js";

/** A single goal entry in the catalog. */
export interface GoalCatalogEntry {
  /** Agda interaction point (goal) ID. */
  goalId: number;
  /** Goal type as reported by Agda. */
  type: string;
  /** Parsed local context entries. */
  context: ContextEntry[];
  /** Splittable (non-implicit) variables from context. */
  splittableVariables: string[];
  /** AI-oriented suggestions for this goal. */
  suggestions: Suggestion[];
}

/** The full goal catalog. */
export interface GoalCatalog {
  /** Total number of visible goals. */
  goalCount: number;
  /** Number of invisible goals (not directly addressable). */
  invisibleGoalCount: number;
  /** Whether the module has any holes. */
  hasHoles: boolean;
  /** Ordered list of goal entries. */
  goals: GoalCatalogEntry[];
}

/** Input for building a goal catalog, decoupled from AgdaSession. */
export interface GoalCatalogInput {
  goals: Array<{ goalId: number; type: string; context: string[] }>;
  invisibleGoalCount: number;
}

/**
 * Build a goal catalog from raw goal data.
 * Pure function — no session access needed.
 */
export function buildGoalCatalog(input: GoalCatalogInput): GoalCatalog {
  const goals = input.goals.map((goal) => {
    const parsedContext = goal.context.map(parseContextEntry);
    const splittableVariables = parsedContext
      .filter((e) => !e.isImplicit && e.name && e.type)
      .map((e) => e.name);
    const suggestions = deriveSuggestions(goal.type, parsedContext);

    return {
      goalId: goal.goalId,
      type: goal.type,
      context: parsedContext,
      splittableVariables,
      suggestions,
    };
  });

  // Sort by goalId for stable ordering
  goals.sort((a, b) => a.goalId - b.goalId);

  const goalCount = goals.length;
  const hasHoles = goalCount > 0 || input.invisibleGoalCount > 0;

  return {
    goalCount,
    invisibleGoalCount: input.invisibleGoalCount,
    hasHoles,
    goals,
  };
}

/**
 * Render a goal catalog as human-readable markdown text.
 */
export function renderGoalCatalogText(catalog: GoalCatalog): string {
  let text = `## Goal Catalog\n\n`;
  text += `**Goals:** ${catalog.goalCount} visible`;
  if (catalog.invisibleGoalCount > 0) {
    text += `, ${catalog.invisibleGoalCount} invisible`;
  }
  text += "\n\n";

  if (catalog.goals.length === 0) {
    text += "_No visible goals._\n";
    return text;
  }

  for (const goal of catalog.goals) {
    text += `### Goal ?${goal.goalId}\n`;
    text += `**Type:** \`${goal.type}\`\n`;

    if (goal.context.length > 0) {
      text += "**Context:**\n";
      for (const entry of goal.context) {
        const prefix = entry.isImplicit ? "{implicit} " : "";
        text += `- ${prefix}\`${entry.name}\` : \`${entry.type}\`\n`;
      }
    }

    if (goal.splittableVariables.length > 0) {
      text += `**Splittable:** ${goal.splittableVariables.map((v) => `\`${v}\``).join(", ")}\n`;
    }

    if (goal.suggestions.length > 0) {
      text += "**Suggestions:**\n";
      for (const s of goal.suggestions) {
        text += `- \`${s.action}\``;
        if (s.expr) text += ` \`${s.expr}\``;
        if (s.variable) text += ` on \`${s.variable}\``;
        text += ` — ${s.reason}\n`;
      }
    }
    text += "\n";
  }

  return text;
}
