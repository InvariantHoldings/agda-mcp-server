import { z } from "zod";
import {
  protocolCommandDefinitionSchema,
  type ProtocolCommandDefinition,
} from "./metadata.js";
import { loadJsonData } from "./json-data.js";

const upstreamParityVerificationSchema = z.object({
  source: z.string().url(),
  verifiedAt: z.string(),
});

export { type CommandCategory, type CommandExposure, type ProtocolCommandDefinition } from "./metadata.js";

export const upstreamParityVerification = loadJsonData(
  "./data/upstream-parity-verification.json",
  upstreamParityVerificationSchema,
  import.meta.url,
);

export const upstreamAgdaCommands = loadJsonData(
  "./data/upstream-agda-commands.json",
  z.array(z.string()),
  import.meta.url,
);

export const protocolCommandRegistry: ProtocolCommandDefinition[] = loadJsonData(
  "./data/protocol-command-registry.json",
  z.array(protocolCommandDefinitionSchema),
  import.meta.url,
);

export function getImplementedProtocolCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => command.implemented);
}

export function getMcpExposedCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => command.exposure === "mcp");
}

export function getPlannedProtocolCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => !command.implemented);
}
