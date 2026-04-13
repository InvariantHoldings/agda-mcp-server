// MIT License — see LICENSE
//
// Barrel re-export — preserves backward compatibility for all consumers.
// Internal modules live in src/agda/.
//
// Architecture:
//   agda/types.ts             — shared type definitions
//   agda/response-parsing.ts  — Agda wire-format helpers
//   agda/session.ts           — stateful AgdaSession class (SSOT)
//
// Note: prior to #39 a separate agda/batch.ts exported a disposable
// typeCheckBatch helper that spawned its own AgdaSession. That caused
// session state desync between agda_typecheck and agda_load. The
// helper has moved to test/helpers/typecheck-disposable.ts and is no
// longer reachable from production code — all load-family tools must
// route through the singleton AgdaSession created in src/index.ts.

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
export { extractMessage, escapeAgdaString } from "./agda/response-parsing.js";
export { normalizeAgdaResponse } from "./agda/normalize-response.js";
export { parseLoadResponses } from "./agda/parse-load-responses.js";
export { parseContextEntry, deriveSuggestions, findMatchingTerms } from "./agda/goal-analysis.js";
