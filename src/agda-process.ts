// MIT License — see LICENSE
//
// Barrel re-export — preserves backward compatibility for all consumers.
// Internal modules live in src/agda/.
//
// Architecture:
//   agda/types.ts             — shared type definitions
//   agda/response-parsing.ts  — Agda wire-format helpers
//   agda/session.ts           — stateful AgdaSession class
//   agda/batch.ts             — stateless batch type-checking

export type {
  AgdaResponse,
  AgdaGoal,
  LoadResult,
  GoalInfo,
  GoalTypeResult,
  ContextResult,
  CaseSplitResult,
  GiveResult,
  ComputeResult,
  InferResult,
  AutoResult,
  SolveResult,
  WhyInScopeResult,
  ElaborateResult,
  HelperFunctionResult,
  ModuleContentsResult,
  SearchAboutResult,
  GoalTypeContextInferResult,
  GoalTypeContextCheckResult,
  ShowVersionResult,
  DisplayControlResult,
  BackendCommandResult,
  TypeCheckResult,
  AgdaCommandContext,
  AgdaSessionContext,
} from "./agda/types.js";

export { AgdaSession, findAgdaBinary } from "./agda/session.js";
export { typeCheckBatch } from "./agda/batch.js";
export { extractMessage, escapeAgdaString } from "./agda/response-parsing.js";
export { normalizeAgdaResponse } from "./agda/normalize-response.js";
export { parseLoadResponses } from "./agda/parse-load-responses.js";
export { parseContextEntry, deriveSuggestions, findMatchingTerms } from "./agda/goal-analysis.js";
