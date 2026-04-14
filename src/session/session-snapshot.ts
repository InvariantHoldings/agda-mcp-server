// MIT License — see LICENSE
//
// Session snapshot domain logic.
//
// Derives a structured snapshot of the current session state,
// optimized for one-call agent introspection. Combines phase,
// loaded file, goal counts, completeness, staleness, and
// available next actions into a single flat record.

import type { SessionPhase } from "./session-state.js";
import type { CompletenessClassification } from "../agda/completeness.js";

/** A structured snapshot of the session state for agent consumption. */
export interface SessionSnapshot {
  /** Current high-level session phase. */
  phase: SessionPhase;
  /** Currently loaded file path (relative), or null. */
  loadedFile: string | null;
  /** Project root directory. */
  projectRoot: string;
  /** Whether the loaded file is stale (modified on disk since last load). */
  stale: boolean;
  /** Number of visible goals (interaction points). */
  goalCount: number;
  /** Goal IDs. */
  goalIds: number[];
  /** Number of invisible goals, if known. */
  invisibleGoalCount: number;
  /** Completeness classification from the last load, if any. */
  classification: CompletenessClassification | null;
  /** Whether the proof is complete (no holes, no errors). */
  isComplete: boolean;
  /** Whether the module has holes. */
  hasHoles: boolean;
  /** Detected Agda version, if known. */
  agdaVersion: string | null;
  /** Wall-clock time (epoch ms) of the most recent load, if any. */
  lastLoadedAt: number | null;
  /** Suggested next tool calls based on current state. */
  suggestedActions: SuggestedAction[];
}

export interface SuggestedAction {
  /** Tool name to call. */
  tool: string;
  /** Why this tool is suggested. */
  rationale: string;
  /** Priority: lower number = higher priority. */
  priority: number;
}

/** Input for deriving a snapshot, decoupled from AgdaSession for testability. */
export interface SnapshotInput {
  phase: SessionPhase;
  loadedFile: string | null;
  projectRoot: string;
  stale: boolean;
  goalIds: number[];
  invisibleGoalCount: number;
  classification: string | null;
  agdaVersion: string | null;
  lastLoadedAt: number | null;
}

/**
 * Derive a session snapshot from session state inputs.
 * Pure function for testability — no side effects.
 */
export function deriveSessionSnapshot(input: SnapshotInput): SessionSnapshot {
  const goalCount = input.goalIds.length;
  const hasHoles = goalCount > 0 || input.invisibleGoalCount > 0;
  const classification = parseClassification(input.classification);
  const isComplete = classification === "ok-complete";

  const suggestedActions = deriveSuggestedActions({
    phase: input.phase,
    classification,
    hasHoles,
    goalCount,
    stale: input.stale,
    loadedFile: input.loadedFile,
  });

  return {
    phase: input.phase,
    loadedFile: input.loadedFile,
    projectRoot: input.projectRoot,
    stale: input.stale,
    goalCount,
    goalIds: [...input.goalIds],
    invisibleGoalCount: input.invisibleGoalCount,
    classification,
    isComplete,
    hasHoles,
    agdaVersion: input.agdaVersion,
    lastLoadedAt: input.lastLoadedAt,
    suggestedActions,
  };
}

function parseClassification(raw: string | null): CompletenessClassification | null {
  if (raw === "ok-complete" || raw === "ok-with-holes" || raw === "type-error") {
    return raw;
  }
  return null;
}

interface ActionInput {
  phase: SessionPhase;
  classification: CompletenessClassification | null;
  hasHoles: boolean;
  goalCount: number;
  stale: boolean;
  loadedFile: string | null;
}

/**
 * Derive suggested next actions from session state.
 * Returns actions sorted by priority (lowest first).
 */
export function deriveSuggestedActions(input: ActionInput): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // Phase: idle or ready — need to load a file
  if (input.phase === "idle" || input.phase === "ready") {
    actions.push({
      tool: "agda_load",
      rationale: "No file loaded. Load a file to begin proof interaction.",
      priority: 1,
    });
    return actions;
  }

  // Phase: busy — wait
  if (input.phase === "busy") {
    return [{
      tool: "agda_session_snapshot",
      rationale: "Session is busy processing a command. Re-check status after it completes.",
      priority: 1,
    }];
  }

  // Stale file — suggest reload
  if (input.stale && input.loadedFile) {
    actions.push({
      tool: "agda_load",
      rationale: "File has been modified since last load. Reload to pick up changes.",
      priority: 1,
    });
  }

  // Type error state
  if (input.classification === "type-error") {
    actions.push({
      tool: "agda_read_module",
      rationale: "Type error detected. Inspect the source to understand the error.",
      priority: 2,
    });
    actions.push({
      tool: "agda_load",
      rationale: "Fix the error and reload.",
      priority: 3,
    });
    actions.push({
      tool: "agda_bug_report_bundle",
      rationale: "If the error is unexpected, file a bug report.",
      priority: 10,
    });
    return actions;
  }

  // Has holes — suggest proof tools
  if (input.hasHoles) {
    if (input.goalCount > 0) {
      actions.push({
        tool: "agda_goal_catalog",
        rationale: `${input.goalCount} goal(s) available. Inspect goal types and contexts.`,
        priority: 2,
      });
      actions.push({
        tool: "agda_goal_type",
        rationale: "Get the type of a specific goal for targeted proof work.",
        priority: 3,
      });
      actions.push({
        tool: "agda_context",
        rationale: "Inspect the local context around a goal.",
        priority: 4,
      });
      actions.push({
        tool: "agda_auto",
        rationale: "Try automatic proof search on a goal.",
        priority: 5,
      });
      actions.push({
        tool: "agda_case_split",
        rationale: "Case split on a variable in a goal.",
        priority: 6,
      });
      actions.push({
        tool: "agda_solve_all",
        rationale: "Attempt to solve all goals automatically.",
        priority: 7,
      });
    }
    return actions;
  }

  // Complete — suggest verification / backend
  if (input.classification === "ok-complete") {
    actions.push({
      tool: "agda_search_about",
      rationale: "Module is complete. Search for related definitions.",
      priority: 5,
    });
    return actions;
  }

  // Default: loaded but unknown state
  if (input.loadedFile) {
    actions.push({
      tool: "agda_goal_catalog",
      rationale: "Inspect current proof state.",
      priority: 3,
    });
  }

  return actions;
}
