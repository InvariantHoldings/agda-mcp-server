import {
  protocolCommandRegistry,
  type ProtocolCommandDefinition,
  upstreamAgdaCommands,
  upstreamParityVerification,
} from "./command-registry.js";
import {
  protocolCoverageLevelSchema,
  protocolParityOverrideSchema,
  protocolParityStatusSchema,
  type ProtocolCoverageLevel,
  type ProtocolParityOverride,
  type ProtocolParityStatus,
} from "./metadata.js";
import { z } from "zod";
import { loadJsonData } from "../json-data.js";

export interface ProtocolParityEntry {
  agdaCommand: string;
  category: ProtocolCommandDefinition["category"];
  exposure: ProtocolCommandDefinition["exposure"];
  implemented: boolean;
  mcpTool?: string;
  parityStatus: ProtocolParityStatus;
  coverageLevel: ProtocolCoverageLevel;
  notes?: string;
  issues: number[];
}

const parityOverrides = loadJsonData(
  "./data/protocol-parity-overrides.json",
  z.record(z.string(), protocolParityOverrideSchema),
  import.meta.url,
) as Record<string, ProtocolParityOverride>;

function defaultCoverageLevel(command: ProtocolCommandDefinition): ProtocolCoverageLevel {
  if (!command.implemented) {
    return protocolCoverageLevelSchema.enum.none;
  }

  return protocolCoverageLevelSchema.enum.unit;
}

function defaultParityStatus(command: ProtocolCommandDefinition): ProtocolParityStatus {
  if (!command.implemented) {
    return protocolParityStatusSchema.enum["known-gap"];
  }

  return protocolParityStatusSchema.enum.mapped;
}

export function buildProtocolParityEntry(
  command: ProtocolCommandDefinition,
): ProtocolParityEntry {
  const override = parityOverrides[command.agdaCommand] ?? {};
  return {
    agdaCommand: command.agdaCommand,
    category: command.category,
    exposure: command.exposure,
    implemented: command.implemented,
    mcpTool: command.mcpTool,
    parityStatus: override.parityStatus ?? defaultParityStatus(command),
    coverageLevel: override.coverageLevel ?? defaultCoverageLevel(command),
    notes: override.notes ?? command.notes,
    issues: [...(override.issues ?? [])],
  };
}

export function listProtocolParityMatrix(): ProtocolParityEntry[] {
  return protocolCommandRegistry
    .map(buildProtocolParityEntry)
    .sort((left, right) => left.agdaCommand.localeCompare(right.agdaCommand));
}

export function getKnownProtocolGaps(): ProtocolParityEntry[] {
  return listProtocolParityMatrix().filter((entry) => entry.parityStatus === "known-gap");
}

export function getProtocolParitySummary() {
  const entries = listProtocolParityMatrix();
  return {
    source: upstreamParityVerification.source,
    verifiedAt: upstreamParityVerification.verifiedAt,
    upstreamCommandCount: upstreamAgdaCommands.length,
    trackedCommandCount: entries.length,
    endToEndCount: entries.filter((entry) => entry.parityStatus === "end-to-end").length,
    verifiedCount: entries.filter((entry) => entry.parityStatus === "verified").length,
    mappedCount: entries.filter((entry) => entry.parityStatus === "mapped").length,
    knownGapCount: entries.filter((entry) => entry.parityStatus === "known-gap").length,
  };
}
