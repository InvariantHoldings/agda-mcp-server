import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

const queryExpectationSchema = z.object({
  expr: z.string().min(1),
  expectedIncludes: z.array(z.string().min(1)).min(1),
});

const goalExpectationSchema = z.object({
  contextIncludes: z.array(z.string().min(1)).optional(),
  compute: queryExpectationSchema.optional(),
  infer: queryExpectationSchema.optional(),
  goalTypeContextInfer: z.object({
    expr: z.string().min(1),
    goalTypeIncludes: z.array(z.string().min(1)).min(1),
    inferredTypeIncludes: z.array(z.string().min(1)).min(1),
    contextIncludes: z.array(z.string().min(1)).optional(),
  }).optional(),
  goalTypeContextCheck: z.object({
    expr: z.string().min(1),
    goalTypeIncludes: z.array(z.string().min(1)).min(1),
    checkedExprIncludes: z.array(z.string().min(1)).min(1),
    contextIncludes: z.array(z.string().min(1)).optional(),
  }).optional(),
});

const expressionScenarioSchema = z.object({
  file: z.string().min(1),
  topLevelCompute: queryExpectationSchema.optional(),
  topLevelInfer: queryExpectationSchema.optional(),
  goal: goalExpectationSchema.optional(),
});

export const expressionQueryMatrix = loadValidatedJsonData(
  import.meta.dirname,
  "./expression-query-matrix.json",
  z.array(expressionScenarioSchema),
);
