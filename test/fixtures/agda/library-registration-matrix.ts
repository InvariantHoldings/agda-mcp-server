import { z } from "zod";

import { loadValidatedJsonData } from "../../helpers/json-data.js";

const fileSpecSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
});

const integrationSpecSchema = z.object({
  loadFile: z.string().min(1),
});

const libraryRegistrationScenarioSchema = z.object({
  name: z.string().min(1),
  projectFiles: z.array(fileSpecSchema),
  agdaDirFiles: z.array(fileSpecSchema),
  expectedAgdaArgs: z.array(z.string()),
  expectedLibraryBasenames: z.array(z.string().min(1)),
  expectedDefaults: z.array(z.string().min(1)),
  integration: integrationSpecSchema.optional(),
});

export type LibraryRegistrationScenario = z.infer<typeof libraryRegistrationScenarioSchema>;

export const libraryRegistrationMatrix: LibraryRegistrationScenario[] = loadValidatedJsonData(
  import.meta.dirname,
  "./library-registration-matrix.json",
  z.array(libraryRegistrationScenarioSchema),
);
