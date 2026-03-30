import { z } from "zod";

export const commandCategorySchema = z.enum([
  "session",
  "proof",
  "navigation",
  "process",
  "highlighting",
  "backend",
]);

export type CommandCategory = z.infer<typeof commandCategorySchema>;

export const commandExposureSchema = z.enum([
  "mcp",
  "internal",
  "planned",
]);

export type CommandExposure = z.infer<typeof commandExposureSchema>;

export const protocolCommandDefinitionSchema = z.object({
  agdaCommand: z.string(),
  category: commandCategorySchema,
  exposure: commandExposureSchema,
  mcpTool: z.string().optional(),
  implemented: z.boolean(),
  notes: z.string().optional(),
});

export type ProtocolCommandDefinition = z.infer<typeof protocolCommandDefinitionSchema>;

export const protocolParityStatusSchema = z.enum([
  "verified",
  "mapped",
  "known-gap",
]);

export type ProtocolParityStatus = z.infer<typeof protocolParityStatusSchema>;

export const protocolCoverageLevelSchema = z.enum([
  "none",
  "unit",
  "integration",
  "mcp",
]);

export type ProtocolCoverageLevel = z.infer<typeof protocolCoverageLevelSchema>;

export const protocolParityOverrideSchema = z.object({
  parityStatus: protocolParityStatusSchema.optional(),
  coverageLevel: protocolCoverageLevelSchema.optional(),
  notes: z.string().optional(),
  issues: z.array(z.number().int().nonnegative()).optional(),
});

export type ProtocolParityOverride = z.infer<typeof protocolParityOverrideSchema>;
