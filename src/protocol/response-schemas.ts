import { z } from "zod";

const passthroughRecordSchema = z.object({}).passthrough();

export const agdaResponseSchema = z.object({
  kind: z.string(),
}).passthrough();

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

const goalTypeAuxSchema = z.object({
  expr: z.string().optional(),
  term: z.string().optional(),
}).passthrough();

export const goalInfoSchema = z.object({
  kind: z.string(),
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

export const displayInfoPayloadSchema = z.union([
  allGoalsWarningsInfoSchema,
  goalSpecificInfoSchema,
  textBearingInfoSchema,
]);

export const displayInfoResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("DisplayInfo"),
  info: displayInfoPayloadSchema,
});

export const interactionPointsResponseSchema = agdaResponseSchema.extend({
  kind: z.literal("InteractionPoints"),
  interactionPoints: z.array(z.number()),
});

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

export function parseResponseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
