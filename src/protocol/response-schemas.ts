import { z } from "zod";

const passthroughRecordSchema = z.object({}).passthrough();

export const agdaResponseSchema = z.object({
  kind: z.string(),
}).passthrough();

export const highlightingInfoResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("HighlightingInfo"),
});

const textBearingInfoSchema = z.object({
  kind: z.string(),
  message: z.string().optional(),
  payload: z.string().optional(),
  contents: z.string().optional(),
  text: z.string().optional(),
  expr: z.string().optional(),
  type: z.string().optional(),
  term: z.string().optional(),
  error: passthroughRecordSchema.optional(),
}).passthrough();

export const allGoalsWarningsInfoSchema = z.object({
  kind: z.literal("AllGoalsWarnings"),
  visibleGoals: z.array(z.unknown()),
  invisibleGoals: z.array(z.unknown()),
  errors: z.array(z.unknown()),
  warnings: z.array(z.unknown()),
}).passthrough();

export const contextEntrySchema = z.object({
  reifiedName: z.string().nullable().optional(),
  originalName: z.string().nullable().optional(),
  binding: z.string().optional(),
}).passthrough();

// InteractionId on the wire: toJSON gives a plain number;
// encodeTCM gives { id: number, range: Range }.
const interactionIdSchema = z.union([
  z.number(),
  z.object({
    id: z.number(),
  }).passthrough(),
]);

// Visible goal entry — OutputConstraint keyed by InteractionId.
// Agda JSONTop.hs: encodeOC encodeTCM encodePrettyTCM for OfType
//   → { kind: "OfType", constraintObj: InteractionId, type: string }
export const goalConstraintEntrySchema = z.object({
  constraintObj: interactionIdSchema.optional(),
  type: z.string().optional(),
}).passthrough();

// NamedMeta on the wire (invisible-goal key):
// Agda JSONTop.hs: encodeTCM NamedMeta → { name: string, range: Range }
// Range encodes as a JSON array of interval objects ([] for noRange).
const namedMetaSchema = z.object({
  name: z.string(),
  range: z.unknown().optional(),
}).passthrough();

// Invisible goal entry — OutputConstraint keyed by NamedMeta.
// Agda JSONTop.hs: encodeOC encodeTCM encodePrettyTCM for OfType
//   → { kind: "OfType", constraintObj: NamedMeta, type: string }
export const invisibleGoalConstraintEntrySchema = z.object({
  constraintObj: namedMetaSchema.optional(),
  type: z.string().optional(),
}).passthrough();

export const diagnosticEntrySchema = z.object({
  message: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

export const contextInfoSchema = z.object({
  kind: z.literal("Context"),
  context: z.array(contextEntrySchema),
}).passthrough();

const goalTypeAuxSchema = z.object({
  expr: z.string().optional(),
  term: z.string().optional(),
}).passthrough();

export const goalTypeInfoSchema = z.object({
  kind: z.literal("GoalType"),
  message: z.string().optional(),
  type: z.string().optional(),
  entries: z.array(contextEntrySchema).optional(),
  typeAux: goalTypeAuxSchema.optional(),
}).passthrough();

export const normalFormInfoSchema = z.object({
  kind: z.literal("NormalForm"),
  expr: z.string().optional(),
  normalForm: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

export const inferredTypeInfoSchema = z.object({
  kind: z.literal("InferredType"),
  type: z.string().optional(),
  expr: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

export const searchAboutEntrySchema = z.object({
  name: z.string(),
  term: z.string(),
}).passthrough();

export const searchAboutInfoSchema = z.object({
  kind: z.literal("SearchAbout"),
  search: z.string().optional(),
  results: z.array(z.unknown()).optional(),
}).passthrough();

export const goalInfoSchema = z.object({
  kind: z.string().optional(),
  type: z.string().optional(),
  expr: z.string().optional(),
  term: z.string().optional(),
  entries: z.array(z.unknown()).optional(),
  typeAux: goalTypeAuxSchema.optional(),
}).passthrough();

export const goalSpecificInfoSchema = z.object({
  kind: z.literal("GoalSpecific"),
  goalInfo: goalInfoSchema,
}).passthrough();

export const interactionPointsResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("InteractionPoints"),
  interactionPoints: z.array(z.number()),
});

export const jumpToErrorResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("JumpToError"),
  filepath: z.string().optional(),
  file: z.string().optional(),
  position: z.number().optional(),
  offset: z.number().optional(),
}).passthrough();

export const giveActionResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("GiveAction"),
  giveResult: z.string().optional(),
  result: z.string().optional(),
});

export const makeCaseResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("MakeCase"),
  clauses: z.array(z.string()).optional(),
});

export const runningInfoResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("RunningInfo"),
  message: z.string().optional(),
  text: z.string().optional(),
});

export const clearRunningInfoResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("ClearRunningInfo"),
}).passthrough();

export const clearHighlightingResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("ClearHighlighting"),
}).passthrough();

export const stderrOutputResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("StderrOutput"),
  text: z.string(),
});

export const solveAllSolutionSchema = z.object({
  interactionPoint: z.number(),
  expression: z.string(),
}).passthrough();

export const solveAllResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("SolveAll"),
  solutions: z.array(solveAllSolutionSchema).optional(),
});

export const mimerResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("Mimer"),
  interactionPoint: z.number().optional(),
  content: z.string().nullable().optional(),
  mime: z.string().nullable().optional(),
}).passthrough();

const statusBodySchema = z.object({
  checked: z.unknown().optional(),
  showImplicitArguments: z.unknown().optional(),
  showIrrelevantArguments: z.unknown().optional(),
}).passthrough();

export const statusResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("Status"),
  checked: z.unknown().optional(),
  showImplicitArguments: z.unknown().optional(),
  showIrrelevantArguments: z.unknown().optional(),
  status: statusBodySchema.optional(),
});

export const doneAbortingResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("DoneAborting"),
});

export const doneExitingResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("DoneExiting"),
});

export const compilationOkInfoSchema = z.object({
  kind: z.literal("CompilationOk"),
}).passthrough();

export const constraintsInfoSchema = z.object({
  kind: z.literal("Constraints"),
  constraints: z.array(z.unknown()).optional(),
}).passthrough();

export const timeInfoSchema = z.object({
  kind: z.literal("Time"),
  cpuTime: z.unknown().optional(),
  message: z.string().optional(),
}).passthrough();

export const infoErrorInnerSchema = z.object({
  message: z.string().optional(),
  kind: z.string().optional(),
}).passthrough();

export const errorInfoSchema = z.object({
  kind: z.literal("Error"),
  error: infoErrorInnerSchema.optional(),
  message: z.string().optional(),
}).passthrough();

export const introNotFoundInfoSchema = z.object({
  kind: z.literal("Intro_NotFound"),
  message: z.string().optional(),
}).passthrough();

export const introConstructorUnknownInfoSchema = z.object({
  kind: z.literal("Intro_ConstructorUnknown"),
  constructors: z.array(z.string()).optional(),
  message: z.string().optional(),
}).passthrough();

export const autoInfoSchema = z.object({
  kind: z.literal("Auto"),
  message: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

export const moduleContentsEntrySchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

export const moduleContentsInfoSchema = z.object({
  kind: z.literal("ModuleContents"),
  names: z.array(z.string()).optional(),
  telescope: z.unknown().optional(),
  contents: z.array(moduleContentsEntrySchema).optional(),
  message: z.string().optional(),
}).passthrough();

export const whyInScopeInfoSchema = z.object({
  kind: z.literal("WhyInScope"),
  message: z.string().optional(),
  contents: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

export const versionInfoSchema = z.object({
  kind: z.literal("Version"),
  version: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

export const goalHelperFunctionInfoSchema = z.object({
  kind: z.literal("HelperFunction"),
  message: z.string().optional(),
  type: z.string().optional(),
  signature: z.string().optional(),
}).passthrough();

export const goalCurrentGoalInfoSchema = z.object({
  kind: z.literal("CurrentGoal"),
  message: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

export const displayInfoPayloadSchema = z.union([
  compilationOkInfoSchema,
  constraintsInfoSchema,
  allGoalsWarningsInfoSchema,
  timeInfoSchema,
  errorInfoSchema,
  introNotFoundInfoSchema,
  introConstructorUnknownInfoSchema,
  autoInfoSchema,
  moduleContentsInfoSchema,
  whyInScopeInfoSchema,
  contextInfoSchema,
  goalTypeInfoSchema,
  normalFormInfoSchema,
  inferredTypeInfoSchema,
  searchAboutInfoSchema,
  versionInfoSchema,
  goalSpecificInfoSchema,
  textBearingInfoSchema,
]);

export const displayInfoResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("DisplayInfo"),
  info: displayInfoPayloadSchema,
});

export function parseResponseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
