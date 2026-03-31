import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

const namedExpectationSchema = z.object({
  name: z.string().min(1),
  expectedIncludes: z.array(z.string().min(1)).min(1),
});

const moduleExpectationSchema = z.object({
  moduleName: z.string().min(1),
  expectedIncludes: z.array(z.string().min(1)).min(1),
});

const exprExpectationSchema = z.object({
  expr: z.string().min(1),
  expectedIncludes: z.array(z.string().min(1)).min(1),
});

const navigationScenarioSchema = z.object({
  file: z.string().min(1),
  topLevel: z.object({
    whyInScope: z.array(namedExpectationSchema).optional(),
    showModule: z.array(moduleExpectationSchema).optional(),
  }).optional(),
  goal: z.object({
    whyInScope: z.array(namedExpectationSchema).optional(),
    showModule: z.array(moduleExpectationSchema).optional(),
    elaborate: z.array(exprExpectationSchema).optional(),
    helperFunction: z.array(exprExpectationSchema).optional(),
  }).optional(),
});

export const navigationQueryMatrix = loadValidatedJsonData(
  import.meta.dirname,
  "./navigation-query-matrix.json",
  z.array(navigationScenarioSchema),
);
