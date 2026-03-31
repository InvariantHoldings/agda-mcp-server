import { extractMessage } from "../../agda/response-parsing.js";
import type { AgdaResponse } from "../../agda/types.js";
import {
  allGoalsWarningsInfoSchema,
  autoInfoSchema,
  compilationOkInfoSchema,
  constraintsInfoSchema,
  contextInfoSchema,
  displayInfoResponseSchema,
  errorInfoSchema,
  goalCurrentGoalInfoSchema,
  goalHelperFunctionInfoSchema,
  goalSpecificInfoSchema,
  goalTypeInfoSchema,
  inferredTypeInfoSchema,
  introConstructorUnknownInfoSchema,
  introNotFoundInfoSchema,
  moduleContentsInfoSchema,
  normalFormInfoSchema,
  parseResponseWithSchema,
  searchAboutEntrySchema,
  searchAboutInfoSchema,
  timeInfoSchema,
  versionInfoSchema,
  whyInScopeInfoSchema,
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

  const compilationOk = compilationOkInfoSchema.safeParse(info);
  if (compilationOk.success) {
    return "";
  }

  const constraints = constraintsInfoSchema.safeParse(info);
  if (constraints.success) {
    return (constraints.data.constraints ?? [])
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : JSON.stringify(entry),
      )
      .join("\n");
  }

  const time = timeInfoSchema.safeParse(info);
  if (time.success) {
    return time.data.message ?? (time.data.cpuTime != null ? String(time.data.cpuTime) : "");
  }

  const errorInfo = errorInfoSchema.safeParse(info);
  if (errorInfo.success) {
    return errorInfo.data.error?.message ?? errorInfo.data.message ?? "";
  }

  const introNotFound = introNotFoundInfoSchema.safeParse(info);
  if (introNotFound.success) {
    return introNotFound.data.message ?? "";
  }

  const introUnknown = introConstructorUnknownInfoSchema.safeParse(info);
  if (introUnknown.success) {
    return introUnknown.data.message ?? (introUnknown.data.constructors ?? []).join("\n");
  }

  const auto = autoInfoSchema.safeParse(info);
  if (auto.success) {
    return auto.data.message ?? auto.data.text ?? "";
  }

  const moduleContents = moduleContentsInfoSchema.safeParse(info);
  if (moduleContents.success) {
    return moduleContents.data.message
      ?? (moduleContents.data.contents ?? [])
        .map((entry) => [entry.name, entry.type].filter(Boolean).join(" : "))
        .filter((line) => line.length > 0)
        .join("\n");
  }

  const whyInScope = whyInScopeInfoSchema.safeParse(info);
  if (whyInScope.success) {
    return whyInScope.data.message ?? whyInScope.data.contents ?? whyInScope.data.text ?? "";
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

  const version = versionInfoSchema.safeParse(info);
  if (version.success) {
    return version.data.version ?? version.data.message ?? version.data.text ?? "";
  }

  const helperFunction = goalHelperFunctionInfoSchema.safeParse(info);
  if (helperFunction.success) {
    return helperFunction.data.signature ?? helperFunction.data.type ?? helperFunction.data.message ?? "";
  }

  const currentGoal = goalCurrentGoalInfoSchema.safeParse(info);
  if (currentGoal.success) {
    return currentGoal.data.type ?? currentGoal.data.message ?? "";
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
