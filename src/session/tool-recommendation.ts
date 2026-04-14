// MIT License — see LICENSE
//
// Tool recommendation domain logic.
//
// Derives recommended next MCP tool calls from the current semantic
// session state. Ordered by priority with rationale and pre-filled
// arguments where possible.

import type { SessionPhase } from "./session-state.js";
import type { CompletenessClassification } from "../agda/completeness.js";
import type { ToolManifestEntry } from "../tools/manifest.js";

/** A recommended next tool call. */
export interface ToolRecommendation {
  /** MCP tool name. */
  tool: string;
  /** Category of the tool. */
  category: string;
  /** Why this tool is recommended now. */
  rationale: string;
  /** Priority: 1 = highest. */
  priority: number;
  /** Pre-filled arguments from session state, if known. */
  knownArgs: Record<string, unknown>;
  /** Blockers: reasons why this tool cannot be called yet. */
  blockers: string[];
}

/** Input for computing recommendations, decoupled from AgdaSession. */
export interface RecommendationInput {
  phase: SessionPhase;
  loadedFile: string | null;
  stale: boolean;
  goalIds: number[];
  classification: string | null;
  /** Available tools from the manifest. */
  availableTools: ToolManifestEntry[];
}

/**
 * Derive tool recommendations from session state.
 * Pure function — no side effects.
 */
export function deriveToolRecommendations(
  input: RecommendationInput,
): ToolRecommendation[] {
  const recommendations: ToolRecommendation[] = [];
  const classification = parseClassification(input.classification);
  const toolSet = new Set(input.availableTools.map((t) => t.name));

  // ── Phase-based recommendations ─────────────────────────────────

  if (input.phase === "idle" || input.phase === "ready") {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_load",
      rationale: "No file loaded. Load a file to begin proof interaction.",
      priority: 1,
      knownArgs: {},
      blockers: [],
    });
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_tools_catalog",
      rationale: "Explore available tools and capabilities.",
      priority: 5,
      knownArgs: {},
      blockers: [],
    });
    return sortByPriority(recommendations);
  }

  if (input.phase === "busy") {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_session_snapshot",
      rationale: "Session is busy. Poll snapshot to check when command completes.",
      priority: 1,
      knownArgs: {},
      blockers: ["Session is currently processing a command."],
    });
    return sortByPriority(recommendations);
  }

  if (input.phase === "exiting") {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_load",
      rationale: "Session is shutting down. Restart by loading a file.",
      priority: 1,
      knownArgs: {},
      blockers: ["Session is exiting."],
    });
    return sortByPriority(recommendations);
  }

  // ── Staleness ───────────────────────────────────────────────────

  if (input.stale && input.loadedFile) {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_load",
      rationale: "File modified on disk since last load. Reload to pick up changes.",
      priority: 1,
      knownArgs: { file: input.loadedFile },
      blockers: [],
    });
  }

  // ── Type error state ────────────────────────────────────────────

  if (classification === "type-error") {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_read_module",
      rationale: "Type error detected. Read the source to understand the error.",
      priority: 2,
      knownArgs: input.loadedFile ? { file: input.loadedFile } : {},
      blockers: [],
    });
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_load",
      rationale: "Fix the error and reload.",
      priority: 3,
      knownArgs: input.loadedFile ? { file: input.loadedFile } : {},
      blockers: [],
    });
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_bug_report_bundle",
      rationale: "If the error is unexpected, file a structured bug report.",
      priority: 10,
      knownArgs: {},
      blockers: [],
    });
    return sortByPriority(recommendations);
  }

  // ── Has holes ──────────────────────────────────────────────────

  if (input.goalIds.length > 0) {
    const firstGoal = input.goalIds[0];

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_goal_catalog",
      rationale: `${input.goalIds.length} goal(s) available. Get a structured overview of all goals.`,
      priority: 2,
      knownArgs: {},
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_goal_type",
      rationale: "Inspect the type of a specific goal.",
      priority: 3,
      knownArgs: { goalId: firstGoal },
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_context",
      rationale: "View local context for a goal to find usable variables.",
      priority: 4,
      knownArgs: { goalId: firstGoal },
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_auto",
      rationale: "Try automatic proof search.",
      priority: 5,
      knownArgs: { goalId: firstGoal },
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_case_split",
      rationale: "Case split on a variable to make progress.",
      priority: 6,
      knownArgs: { goalId: firstGoal },
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_solve_all",
      rationale: "Attempt to solve all goals at once.",
      priority: 7,
      knownArgs: {},
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_refine",
      rationale: "Refine the goal to introduce structure.",
      priority: 8,
      knownArgs: { goalId: firstGoal, expr: "" },
      blockers: [],
    });

    return sortByPriority(recommendations);
  }

  // ── Complete module ────────────────────────────────────────────

  if (classification === "ok-complete") {
    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_search_about",
      rationale: "Module is complete. Search for related definitions or explore further.",
      priority: 3,
      knownArgs: {},
      blockers: [],
    });

    addIfAvailable(recommendations, toolSet, input.availableTools, {
      tool: "agda_read_module",
      rationale: "Read the completed module source.",
      priority: 4,
      knownArgs: input.loadedFile ? { file: input.loadedFile } : {},
      blockers: [],
    });

    return sortByPriority(recommendations);
  }

  // ── Default: loaded but no specific state ──────────────────────

  addIfAvailable(recommendations, toolSet, input.availableTools, {
    tool: "agda_session_snapshot",
    rationale: "Check current session state.",
    priority: 3,
    knownArgs: {},
    blockers: [],
  });

  return sortByPriority(recommendations);
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseClassification(raw: string | null): CompletenessClassification | null {
  if (raw === "ok-complete" || raw === "ok-with-holes" || raw === "type-error") {
    return raw;
  }
  return null;
}

function addIfAvailable(
  recommendations: ToolRecommendation[],
  toolSet: Set<string>,
  availableTools: ToolManifestEntry[],
  rec: Omit<ToolRecommendation, "category">,
): void {
  if (!toolSet.has(rec.tool)) return;
  // Prevent duplicate tools
  if (recommendations.some((r) => r.tool === rec.tool)) return;

  const entry = availableTools.find((t) => t.name === rec.tool);
  recommendations.push({
    ...rec,
    category: entry?.category ?? "unknown",
  });
}

function sortByPriority(recs: ToolRecommendation[]): ToolRecommendation[] {
  return recs.sort((a, b) => a.priority - b.priority);
}
