// MIT License — see LICENSE
//
// Barrel for the agent-UX static-analysis helpers. The 509-line
// original was a grab bag of error classification, source parsing,
// scoped renames, and clause/fixity inference. Each cohesive area now
// lives in its own module:
//
//   - error-classifier.ts  Triage classes / `classifyAgdaError` /
//                          `extractSuggestedRename` /
//                          `rewriteCompilerPlaceholders` /
//                          `normalizeConfidence`.
//   - source-parsers.ts    `parseOptionsPragmas`, `parseAgdaLibFlags`,
//                          `parseModuleSourceShape`,
//                          `parseTopLevelDefinitions`,
//                          `extractPostulateSites`, plus their types.
//   - refactor-helpers.ts  `splitWords`, `matchesTypePattern`,
//                          `applyScopedRename`, `buildAutoSearchPayload`,
//                          plus `ScopedRenameResult` /
//                          `AutoSearchOptions`.
//   - clause-fixity.ts     `inferMissingClauseArity`,
//                          `buildMissingClause`, `inferFixityConflicts`,
//                          plus `FixityConflict`.
//
// This barrel preserves the public surface unchanged so consumers
// (`tools/agent-ux/edit-tools.ts`, `tools/agent-ux/import-tools.ts`,
// `tools/agent-ux/options-tools.ts`, `tools/agent-ux/project-tools.ts`,
// `tools/agent-ux/shared.ts`, and tests) keep working.

export type {
  TriageClass,
  TriageSuggestedAction,
  TriageResult,
} from "./error-classifier.js";
export {
  classifyAgdaError,
  extractSuggestedRename,
  normalizeConfidence,
  rewriteCompilerPlaceholders,
} from "./error-classifier.js";

export type {
  AutoSearchOptions,
  ScopedRenameResult,
} from "./refactor-helpers.js";
export {
  applyScopedRename,
  buildAutoSearchPayload,
  matchesTypePattern,
  splitWords,
} from "./refactor-helpers.js";

export type {
  DefinitionSite,
  ImportStatement,
  ModuleSourceShape,
  PostulateSite,
} from "./source-parsers.js";
export {
  extractPostulateSites,
  parseAgdaLibFlags,
  parseModuleSourceShape,
  parseOptionsPragmas,
  parseTopLevelDefinitions,
} from "./source-parsers.js";

export type { FixityConflict } from "./clause-fixity.js";
export {
  buildMissingClause,
  inferFixityConflicts,
  inferMissingClauseArity,
} from "./clause-fixity.js";
