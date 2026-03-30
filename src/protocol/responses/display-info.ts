import { extractMessage } from "../../agda/response-parsing.js";
import type { AgdaResponse } from "../../agda/types.js";
import {
  allGoalsWarningsInfoSchema,
  contextInfoSchema,
  displayInfoResponseSchema,
  goalSpecificInfoSchema,
  goalTypeInfoSchema,
  inferredTypeInfoSchema,
  normalFormInfoSchema,
  parseResponseWithSchema,
  searchAboutEntrySchema,
  searchAboutInfoSchema,
} from "../response-schemas.js";

export interface DisplayInfoEvent {
  source: "top-level" | "goal-specific";
  infoKind: string;
  text: string;
  payload: Record<string, unknown>;
}

function decodeStructuredInfoText(info: Record<string, unknown>): string {
  const allGoalsWarnings = allGoalsWarningsInfoSchema.safeParse(info);
  if (allGoalsWarnings.success) {
    return extractMessage(allGoalsWarnings.data);
  }

  const goalType = goalTypeInfoSchema.safeParse(info);
  if (goalType.success) {
    return goalType.data.type
      ?? goalType.data.typeAux?.expr
      ?? goalType.data.typeAux?.term
      ?? goalType.data.message
      ?? "";
  }

  const normalForm = normalFormInfoSchema.safeParse(info);
  if (normalForm.success) {
    return normalForm.data.expr
      ?? normalForm.data.normalForm
      ?? normalForm.data.message
      ?? "";
  }

  const inferredType = inferredTypeInfoSchema.safeParse(info);
  if (inferredType.success) {
    return inferredType.data.type
      ?? inferredType.data.expr
      ?? inferredType.data.message
      ?? "";
  }

  const searchAbout = searchAboutInfoSchema.safeParse(info);
  if (searchAbout.success) {
    return (searchAbout.data.results ?? [])
      .map((entry) => searchAboutEntrySchema.safeParse(entry))
      .filter((entry) => entry.success)
      .map((entry) => `${entry.data.name} : ${entry.data.term}`)
      .join("\n");
  }

  const context = contextInfoSchema.safeParse(info);
  if (context.success) {
    return "";
  }

  return extractMessage(info);
}

function toDisplayInfoEvent(
  info: Record<string, unknown>,
  source: "top-level" | "goal-specific",
): DisplayInfoEvent {
  return {
    source,
    infoKind: typeof info.kind === "string" ? info.kind : "Unknown",
    text: decodeStructuredInfoText(info),
    payload: info,
  };
}

export function decodeDisplayInfoEvents(
  responses: AgdaResponse[],
): DisplayInfoEvent[] {
  const events: DisplayInfoEvent[] = [];

  for (const response of responses) {
    const display = parseResponseWithSchema(displayInfoResponseSchema, response);
    if (!display) {
      continue;
    }

    const goalSpecific = goalSpecificInfoSchema.safeParse(display.info);
    if (goalSpecific.success) {
      events.push(
        toDisplayInfoEvent(
          goalSpecific.data.goalInfo,
          "goal-specific",
        ),
      );
      continue;
    }

    if (display.info.kind === "GoalSpecific") {
      continue;
    }

    events.push(
      toDisplayInfoEvent(display.info, "top-level"),
    );
  }

  return events;
}
