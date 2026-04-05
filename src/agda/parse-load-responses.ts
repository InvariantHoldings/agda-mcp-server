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
  timeInfoSchema,
  runningInfoResponseSchema,
} from "../protocol/response-schemas.js";
import { decodeDisplayInfoEvents } from "../protocol/responses/display-info.js";
import { decodeLoadDisplayResponses } from "../protocol/responses/load-display.js";
import {
  decodeInteractionPointIds,
  decodeStderrOutputs,
} from "../protocol/responses/process-output.js";

export interface ParsedLoadResult extends LoadResult {
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
  options?: { profilingEnabled?: boolean },
): ParsedLoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const goals: AgdaGoal[] = [];
  const goalIds: number[] = [];
  const loadDisplay = decodeLoadDisplayResponses(responses);
  const allGoalsText = loadDisplay.text;
  let success = true;
  let invisibleGoalCount = loadDisplay.invisibleGoalCount;
  const interactionPointIds = decodeInteractionPointIds(responses);
  const stderrTexts = decodeStderrOutputs(responses);

  for (const resp of responses) {
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
  }

  const seenInteractionPoints = new Set(goalIds);
  for (const id of interactionPointIds) {
    if (!seenInteractionPoints.has(id)) {
      seenInteractionPoints.add(id);
      goalIds.push(id);
      goals.push({ goalId: id, type: "?", context: [] });
    }
  }

  for (const text of stderrTexts) {
    if (/\berror\b/i.test(text)) {
      errors.push(text);
      success = false;
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

  const profiling = extractProfilingOutput(responses, options);

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
    profiling,
  };
}

/**
 * Extract profiling output from Agda responses.
 *
 * When `--profile=` options are active, Agda emits profiling data via:
 * - DisplayInfo with info.kind === "Time" (timing/profiling summary)
 * - RunningInfo messages (incremental profiling output)
 *
 * When `profilingEnabled` is false (the default), only DisplayInfo/Time
 * responses are collected — RunningInfo is ignored because those messages
 * are also used for general progress/status (e.g. "Checking Module …").
 *
 * Returns the combined profiling text, or null if no profiling data
 * was found in the responses.
 */
export function extractProfilingOutput(
  responses: AgdaResponse[],
  options?: { profilingEnabled?: boolean },
): string | null {
  const includeRunningInfo = options?.profilingEnabled ?? false;
  const parts: string[] = [];

  for (const resp of responses) {
    if (resp.kind === "DisplayInfo") {
      const display = parseResponseWithSchema(displayInfoResponseSchema, resp);
      if (!display) continue;
      const info = display.info;

      if (info.kind === "Time") {
        const time = timeInfoSchema.safeParse(info);
        if (time.success) {
          const text = time.data.message ?? time.data.cpuTime?.toString() ?? "";
          if (text) parts.push(text);
        }
      }
    }

    if (includeRunningInfo && resp.kind === "RunningInfo") {
      const running = parseResponseWithSchema(runningInfoResponseSchema, resp);
      if (running) {
        const text = running.message ?? running.text ?? "";
        if (text) parts.push(text);
      }
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
