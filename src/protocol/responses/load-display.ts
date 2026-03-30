import type { AgdaResponse } from "../../agda/types.js";
import {
  allGoalsWarningsInfoSchema,
  diagnosticEntrySchema,
  goalConstraintEntrySchema,
  parseResponseWithSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

export interface DecodedGoalConstraint {
  goalId: number;
  type: string;
}

export interface DecodedLoadDisplay {
  text: string;
  visibleGoals: DecodedGoalConstraint[];
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

  return {
    goalId: parsed.data.constraintObj,
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
  let invisibleGoalCount = 0;

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

    invisibleGoalCount = payload.invisibleGoals.length;

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
    invisibleGoalCount,
    warnings,
    errors,
  };
}
