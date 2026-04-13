// MIT License — see LICENSE
//
// Barrel re-export for tool helpers.
//
// This module used to hold all of: ToolEnvelope/ToolResult types,
// diagnostic constructors, provenance registry, error translation,
// session/goal gates, and register*Tool wrappers. It grew past 700
// lines so it was split into five focused modules; this file stays
// as a thin re-export so every existing `import … from "./tool-helpers"`
// call site in src/ and test/ keeps working unchanged.
//
// Internal modules (import directly from these in new code):
//   - tool-provenance.ts   — global provenance registry
//   - tool-envelope.ts     — envelope types, schemas, constructors
//   - tool-errors.ts       — ToolInvocationError, missingPathToolError
//   - tool-gates.ts        — session + goal gates, staleness warning
//   - tool-registration.ts — register*Tool wrappers, wrap*Handler

export {
  registerGlobalProvenance,
  clearGlobalProvenance,
  mergeProvenance,
  type ProvenanceRecord,
} from "./tool-provenance.js";

export {
  diagnosticSchema,
  errorDiagnostic,
  errorEnvelope,
  infoDiagnostic,
  makeToolResult,
  okEnvelope,
  text,
  toolEnvelopeSchema,
  warningDiagnostic,
  type ToolDiagnostic,
  type ToolEnvelope,
  type ToolResult,
} from "./tool-envelope.js";

export {
  ToolInvocationError,
  makeTextToolErrorResult,
  missingPathToolError,
  toToolInvocationError,
} from "./tool-errors.js";

export {
  groupDiagnosticsByFile,
  sessionErrorStateGate,
  stalenessWarning,
  validateGoalId,
} from "./tool-gates.js";

export {
  registerGoalTextTool,
  registerStructuredTool,
  registerTextTool,
  wrapGoalHandler,
  wrapHandler,
  wrapStructuredGoalHandler,
  wrapStructuredHandler,
} from "./tool-registration.js";
