// MIT License — see LICENSE
//
// Pure function to parse Agda's Cmd_load response sequence into a
// structured LoadResult. Expects pre-normalized responses (see
// normalize-response.ts).

import type { AgdaResponse, AgdaGoal, LoadResult } from "./types.js";
import { classifyCompleteness } from "./completeness.js";
import {
  displayInfoResponseSchema,
  parseResponseWithSchema,
} from "../protocol/response-schemas.js";
import { decodeDisplayInfoEvents } from "../protocol/responses/display-info.js";
import { decodeLoadDisplayResponses } from "../protocol/responses/load-display.js";

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
  const loadDisplay = decodeLoadDisplayResponses(responses);
  const allGoalsText = loadDisplay.text;
  let success = true;
  let invisibleGoalCount = loadDisplay.invisibleGoalCount;

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
      const display = parseResponseWithSchema(displayInfoResponseSchema, resp);
      if (!display) continue;
      const info = display.info;

      if (info.kind === "Error") {
        success = false;
        const text = decodeDisplayInfoEvents([resp]).at(-1)?.text ?? "";
        if (text) {
          errors.push(text);
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

  if (loadDisplay.errors.length > 0) {
    success = false;
    errors.push(...loadDisplay.errors);
  }
  warnings.push(...loadDisplay.warnings);

  const existingIds = new Set(goalIds);
  for (const visibleGoal of loadDisplay.visibleGoals) {
    const existing = goals.find((goal) => goal.goalId === visibleGoal.goalId);
    if (existing) {
      existing.type = visibleGoal.type;
      continue;
    }

    if (!existingIds.has(visibleGoal.goalId)) {
      goalIds.push(visibleGoal.goalId);
      goals.push({
        goalId: visibleGoal.goalId,
        type: visibleGoal.type,
        context: [],
      });
      existingIds.add(visibleGoal.goalId);
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
