import { test, expect } from "vitest";

import {
  listOfficialDisplayInfoKinds,
  listOfficialGoalDisplayInfoKinds,
  listOfficialResponseKinds,
} from "../../../tooling/protocol/official-response-inventory.js";
import {
  allGoalsWarningsInfoSchema,
  autoInfoSchema,
  clearHighlightingResponseSchema,
  clearRunningInfoResponseSchema,
  compilationOkInfoSchema,
  constraintsInfoSchema,
  contextInfoSchema,
  displayInfoResponseSchema,
  doneAbortingResponseSchema,
  doneExitingResponseSchema,
  errorInfoSchema,
  giveActionResponseSchema,
  goalCurrentGoalInfoSchema,
  goalHelperFunctionInfoSchema,
  goalSpecificInfoSchema,
  goalTypeInfoSchema,
  highlightingInfoResponseSchema,
  inferredTypeInfoSchema,
  interactionPointsResponseSchema,
  introConstructorUnknownInfoSchema,
  introNotFoundInfoSchema,
  jumpToErrorResponseSchema,
  makeCaseResponseSchema,
  mimerResponseSchema,
  moduleContentsInfoSchema,
  normalFormInfoSchema,
  parseResponseWithSchema,
  runningInfoResponseSchema,
  searchAboutInfoSchema,
  solveAllResponseSchema,
  statusResponseSchema,
  timeInfoSchema,
  versionInfoSchema,
  whyInScopeInfoSchema,
} from "../../../src/protocol/response-schemas.js";

const responseSamples = {
  HighlightingInfo: { kind: "HighlightingInfo" },
  Status: { kind: "Status", checked: true },
  JumpToError: { kind: "JumpToError", filepath: "Test.agda", position: 1 },
  InteractionPoints: { kind: "InteractionPoints", interactionPoints: [1] },
  GiveAction: { kind: "GiveAction", giveResult: "ok" },
  MakeCase: { kind: "MakeCase", clauses: ["f zero = ?"] },
  SolveAll: { kind: "SolveAll", solutions: [{ interactionPoint: 1, expression: "refl" }] },
  Mimer: { kind: "Mimer", interactionPoint: 1, content: "x" },
  DisplayInfo: { kind: "DisplayInfo", info: { kind: "Version", text: "Agda 2.x" } },
  RunningInfo: { kind: "RunningInfo", message: "Checking" },
  ClearRunningInfo: { kind: "ClearRunningInfo" },
  ClearHighlighting: { kind: "ClearHighlighting" },
  DoneAborting: { kind: "DoneAborting" },
  DoneExiting: { kind: "DoneExiting" },
};

const responseSchemas = {
  HighlightingInfo: highlightingInfoResponseSchema,
  Status: statusResponseSchema,
  JumpToError: jumpToErrorResponseSchema,
  InteractionPoints: interactionPointsResponseSchema,
  GiveAction: giveActionResponseSchema,
  MakeCase: makeCaseResponseSchema,
  SolveAll: solveAllResponseSchema,
  Mimer: mimerResponseSchema,
  DisplayInfo: displayInfoResponseSchema,
  RunningInfo: runningInfoResponseSchema,
  ClearRunningInfo: clearRunningInfoResponseSchema,
  ClearHighlighting: clearHighlightingResponseSchema,
  DoneAborting: doneAbortingResponseSchema,
  DoneExiting: doneExitingResponseSchema,
};

const displaySamples = {
  CompilationOk: { kind: "CompilationOk" },
  Constraints: { kind: "Constraints", constraints: [] },
  AllGoalsWarnings: { kind: "AllGoalsWarnings", visibleGoals: [], invisibleGoals: [], errors: [], warnings: [] },
  Time: { kind: "Time", cpuTime: 1 },
  Error: { kind: "Error", error: { message: "bad" } },
  Intro_NotFound: { kind: "Intro_NotFound", message: "missing" },
  Intro_ConstructorUnknown: { kind: "Intro_ConstructorUnknown", constructors: ["zero"] },
  Auto: { kind: "Auto", message: "done" },
  ModuleContents: { kind: "ModuleContents", contents: [{ name: "flip", type: "Nat" }] },
  SearchAbout: { kind: "SearchAbout", results: [{ name: "map", term: "A" }] },
  WhyInScope: { kind: "WhyInScope", text: "in scope" },
  NormalForm: { kind: "NormalForm", expr: "zero" },
  InferredType: { kind: "InferredType", type: "Nat" },
  Context: { kind: "Context", context: [] },
  Version: { kind: "Version", text: "Agda 2.x" },
  GoalSpecific: { kind: "GoalSpecific", goalInfo: { kind: "GoalType", type: "Nat" } },
};

const displaySchemas = {
  CompilationOk: compilationOkInfoSchema,
  Constraints: constraintsInfoSchema,
  AllGoalsWarnings: allGoalsWarningsInfoSchema,
  Time: timeInfoSchema,
  Error: errorInfoSchema,
  Intro_NotFound: introNotFoundInfoSchema,
  Intro_ConstructorUnknown: introConstructorUnknownInfoSchema,
  Auto: autoInfoSchema,
  ModuleContents: moduleContentsInfoSchema,
  SearchAbout: searchAboutInfoSchema,
  WhyInScope: whyInScopeInfoSchema,
  NormalForm: normalFormInfoSchema,
  InferredType: inferredTypeInfoSchema,
  Context: contextInfoSchema,
  Version: versionInfoSchema,
  GoalSpecific: goalSpecificInfoSchema,
};

const goalDisplaySamples = {
  HelperFunction: { kind: "HelperFunction", type: "helper : Nat" },
  NormalForm: { kind: "NormalForm", expr: "zero" },
  GoalType: { kind: "GoalType", type: "Nat" },
  CurrentGoal: { kind: "CurrentGoal", type: "Nat" },
  InferredType: { kind: "InferredType", type: "Nat" },
};

const goalDisplaySchemas = {
  HelperFunction: goalHelperFunctionInfoSchema,
  NormalForm: normalFormInfoSchema,
  GoalType: goalTypeInfoSchema,
  CurrentGoal: goalCurrentGoalInfoSchema,
  InferredType: inferredTypeInfoSchema,
};

test("every official response kind has a parsing schema contract", () => {
  for (const kind of listOfficialResponseKinds()) {
    expect(kind in responseSchemas, `missing response schema for ${kind}`).toBeTruthy();
    const parsed = parseResponseWithSchema(responseSchemas[kind], responseSamples[kind]);
    expect(parsed, `response schema did not parse representative ${kind}`).toBeTruthy();
  }
});

test("every official DisplayInfo kind has a parsing schema contract", () => {
  for (const kind of listOfficialDisplayInfoKinds()) {
    expect(kind in displaySchemas, `missing display schema for ${kind}`).toBeTruthy();
    const parsed = parseResponseWithSchema(displaySchemas[kind], displaySamples[kind]);
    expect(parsed, `display schema did not parse representative ${kind}`).toBeTruthy();
  }
});

test("every official GoalDisplayInfo kind has a parsing schema contract", () => {
  for (const kind of listOfficialGoalDisplayInfoKinds()) {
    expect(kind in goalDisplaySchemas, `missing goal display schema for ${kind}`).toBeTruthy();
    const parsed = parseResponseWithSchema(goalDisplaySchemas[kind], goalDisplaySamples[kind]);
    expect(parsed, `goal display schema did not parse representative ${kind}`).toBeTruthy();
  }
});
