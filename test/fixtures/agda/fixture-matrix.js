import { z } from "zod";
import { loadValidatedJsonData } from "../../helpers/json-data.js";

const searchQuerySchema = z.object({
  query: z.string().min(1),
  minResults: z.number().int().nonnegative().optional(),
  expectedNames: z.array(z.string().min(1)).min(1),
});

const fixtureSchema = z.object({
  name: z.string().min(1),
  expectedSuccess: z.boolean(),
  expectedClassification: z.string().min(1),
  minVisibleGoalCount: z.number().int().nonnegative(),
  minHoleCount: z.number().int().nonnegative(),
  expectedStrictSuccess: z.boolean(),
  expectedStrictClassification: z.string().min(1),
  searchQueries: z.array(searchQuerySchema).optional(),
});

export const fixtureMatrix = loadValidatedJsonData(
  import.meta.dirname,
  "./fixture-matrix.json",
  z.array(fixtureSchema),
);
