import type { AgdaResponse } from "../../agda/types.js";
import {
  allGoalsWarningsInfoSchema,
  diagnosticEntrySchema,
  goalConstraintEntrySchema,
  invisibleGoalConstraintEntrySchema,
  parseResponseWithSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

/**
 * A decoded visible goal (interaction point).
 *
 * Maps to an IOTCM `OutputConstraint Expr InteractionId` entry
 * from `AllGoalsWarnings.visibleGoals`.
 */
export interface DecodedGoalConstraint {
  goalId: number;
  type: string;
}

/**
 * A decoded invisible goal (unsolved metavariable).
 *
 * Maps to an IOTCM `OutputConstraint Expr NamedMeta` entry
 * from `AllGoalsWarnings.invisibleGoals`. The `name` field comes
 * from the Agda NamedMeta's `encodeTCM` instance (e.g. `"_42"`).
 */
export interface DecodedInvisibleGoal {
  name: string;
  type: string;
}

export interface DecodedLoadDisplay {
  text: string;
  /** Visible goals — IOTCM `AllGoalsWarnings.visibleGoals`. */
  visibleGoals: DecodedGoalConstraint[];
  /**
   * Invisible goals — IOTCM `AllGoalsWarnings.invisibleGoals`.
   * Each entry is a decoded unsolved metavariable with its
   * NamedMeta name and type.
   *
   * When multiple `AllGoalsWarnings` events arrive in one load,
   * we keep the array with the most entries (max-by-length).
   * In practice Agda's later events have fewer-or-equal entries
   * (as metas get solved), so this matches the original
   * `Math.max(count)` behaviour while preserving structure.
   * A union is not used because later events represent the
   * current state, not an additive accumulation.
   */
  invisibleGoals: DecodedInvisibleGoal[];
  /** Count shorthand — always equals `invisibleGoals.length`. */
  invisibleGoalCount: number;
  warnings: string[];
  errors: string[];
}

function decodeDiagnosticText(entry: unknown): string {
  if (typeof entry === "string") {
    return entry;
  }

  const diagnostic = diagnosticEntrySchema.safeParse(entry);
  if (diagnostic.success) {
    return diagnostic.data.message
      ?? diagnostic.data.type
      ?? JSON.stringify(entry);
  }

  return JSON.stringify(entry);
}

function decodeGoalConstraint(entry: unknown): DecodedGoalConstraint | null {
  const parsed = goalConstraintEntrySchema.safeParse(entry);
  if (!parsed.success || parsed.data.constraintObj === undefined) {
    return null;
  }

  const goalId = typeof parsed.data.constraintObj === "number"
    ? parsed.data.constraintObj
    : parsed.data.constraintObj.id;

  return {
    goalId,
    type: parsed.data.type ?? "?",
  };
}

/**
 * Decode an invisible-goal `OutputConstraint Expr NamedMeta` entry.
 *
 * Per Agda JSONTop.hs, NamedMeta encodes as `{name: string, range: Range}`.
 * We extract the meta name and the pretty-printed type.
 */
function decodeInvisibleGoalConstraint(entry: unknown): DecodedInvisibleGoal | null {
  const parsed = invisibleGoalConstraintEntrySchema.safeParse(entry);
  if (!parsed.success || parsed.data.constraintObj === undefined) {
    return null;
  }
  return {
    name: parsed.data.constraintObj.name,
    type: parsed.data.type ?? "?",
  };
}

export function decodeLoadDisplayResponses(
  responses: AgdaResponse[],
): DecodedLoadDisplay {
  const allGoalTexts: string[] = [];
  const visibleGoals: DecodedGoalConstraint[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let invisibleGoals: DecodedInvisibleGoal[] = [];

  for (const event of decodeDisplayInfoEvents(responses)) {
    if (event.infoKind !== "AllGoalsWarnings") {
      continue;
    }

    const payload = parseResponseWithSchema(allGoalsWarningsInfoSchema, event.payload);
    if (!payload) {
      continue;
    }

    if (event.text) {
      allGoalTexts.push(event.text);
    }

    for (const entry of payload.visibleGoals) {
      const decoded = decodeGoalConstraint(entry);
      if (decoded) {
        visibleGoals.push(decoded);
      }
    }

    // Preserve the largest invisible-goals set across multiple
    // AllGoalsWarnings events to prevent undercount when a later
    // event has fewer entries.
    const eventInvisible: DecodedInvisibleGoal[] = [];
    for (const entry of payload.invisibleGoals) {
      const decoded = decodeInvisibleGoalConstraint(entry);
      if (decoded) {
        eventInvisible.push(decoded);
      }
    }
    if (eventInvisible.length > invisibleGoals.length) {
      invisibleGoals = eventInvisible;
    }

    warnings.push(
      ...payload.warnings
        .map(decodeDiagnosticText)
        .filter((message) => message.trim().length > 0),
    );
    errors.push(
      ...payload.errors
        .map(decodeDiagnosticText)
        .filter((message) => message.trim().length > 0),
    );
  }

  return {
    text: allGoalTexts.at(-1) ?? "",
    visibleGoals,
    invisibleGoals,
    invisibleGoalCount: invisibleGoals.length,
    warnings,
    errors,
  };
}
