// MIT License — see LICENSE
//
// Pure function to parse Agda's Cmd_load response sequence into a
// structured LoadResult. Expects pre-normalized responses (see
// normalize-response.ts).

import type { AgdaResponse, AgdaGoal, LoadResult } from "./types.js";
import { extractMessage } from "./response-parsing.js";
import { classifyCompleteness } from "./completeness.js";

export interface ParsedLoadResult extends Omit<LoadResult, "raw"> {
  /** Goal IDs for atomic assignment to session state. */
  goalIds: number[];
}

/**
 * Parse a normalized Cmd_load response sequence.
 *
 * After normalization guarantees:
 * - InteractionPoints.interactionPoints: number[]
 * - AllGoalsWarnings .visibleGoals/.invisibleGoals/.errors/.warnings: arrays
 * - StderrOutput.text: string
 */
export function parseLoadResponses(
  responses: AgdaResponse[],
): ParsedLoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const goals: AgdaGoal[] = [];
  const goalIds: number[] = [];
  let allGoalsText = "";
  let success = true;
  let invisibleGoalCount = 0;

  for (const resp of responses) {
    // ── InteractionPoints (normalized: always number[]) ──
    if (resp.kind === "InteractionPoints") {
      const points = resp.interactionPoints as number[];
      if (Array.isArray(points)) {
        const seen = new Set(goalIds);
        for (const id of points) {
          if (!seen.has(id)) {
            seen.add(id);
            goalIds.push(id);
            goals.push({ goalId: id, type: "?", context: [] });
          }
        }
      }
    }

    // ── DisplayInfo ──────────────────────────────────────
    if (resp.kind === "DisplayInfo") {
      const info = resp.info as Record<string, unknown> | undefined;
      if (!info) continue;

      if (info.kind === "Error") {
        success = false;
        errors.push(extractMessage(info));
      }

      if (info.kind === "AllGoalsWarnings") {
        allGoalsText = extractMessage(info);

        // Errors (normalized: always an array)
        const infoErrors = info.errors as unknown[];
        if (infoErrors && infoErrors.length > 0) {
          success = false;
          for (const e of infoErrors) {
            if (typeof e === "string") {
              errors.push(e);
            } else if (e && typeof e === "object") {
              const obj = e as Record<string, unknown>;
              errors.push(
                typeof obj.message === "string"
                  ? obj.message
                  : JSON.stringify(e),
              );
            }
          }
        }

        // Warnings (normalized: always an array)
        const infoWarnings = info.warnings as unknown[];
        if (infoWarnings && infoWarnings.length > 0) {
          for (const w of infoWarnings) {
            if (typeof w === "string") {
              warnings.push(w);
            } else if (w && typeof w === "object") {
              const obj = w as Record<string, unknown>;
              warnings.push(
                typeof obj.message === "string"
                  ? obj.message
                  : JSON.stringify(w),
              );
            }
          }
        }

        // Cross-check: visibleGoals may have entries not in InteractionPoints
        const visGoals = info.visibleGoals as unknown[];
        if (visGoals) {
          const existingIds = new Set(goalIds);
          for (const vg of visGoals) {
            const obj = vg as Record<string, unknown>;
            const id =
              typeof obj.constraintObj === "number"
                ? obj.constraintObj
                : undefined;
            if (id !== undefined) {
              // Enrich existing goals with type from visibleGoals
              const existing = goals.find((g) => g.goalId === id);
              if (existing && typeof obj.type === "string") {
                existing.type = obj.type;
              }
              // Add goals missing from InteractionPoints
              if (!existingIds.has(id)) {
                goalIds.push(id);
                goals.push({
                  goalId: id,
                  type: typeof obj.type === "string" ? obj.type : "?",
                  context: [],
                });
                existingIds.add(id);
              }
            }
          }
        }

        // Track invisible goals (abstract blocks)
        const invisGoals = info.invisibleGoals as unknown[];
        if (invisGoals) {
          invisibleGoalCount = invisGoals.length;
        }
      }
    }

    // ── StderrOutput (normalized: text is always string) ─
    if (resp.kind === "StderrOutput") {
      const text = ((resp.text as string) ?? "").trim();
      if (text && /\berror\b/i.test(text)) {
        errors.push(text);
        success = false;
      }
    }
  }

  const completeness = classifyCompleteness({
    success,
    goals,
    invisibleGoalCount,
  });

  return {
    success,
    errors,
    warnings,
    goals,
    goalIds,
    allGoalsText,
    invisibleGoalCount,
    goalCount: completeness.goalCount,
    hasHoles: completeness.hasHoles,
    isComplete: completeness.isComplete,
    classification: completeness.classification,
  };
}
