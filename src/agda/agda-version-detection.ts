// MIT License — see LICENSE
//
// Inline Agda-version detection for `AgdaSession`. Each session does
// up to `VERSION_DETECTION_MAX_ATTEMPTS` round-trips of `Cmd_show_version`
// before the user's first real command, populating
// `session.getAgdaVersion()` so every downstream tool sees the version.
//
// When the user's command IS itself `Cmd_show_version`, we piggyback —
// extract the version from those responses instead of running a
// pre-flight round-trip first. That saves one round-trip on the first
// `agda_show_version` invocation.

import type { ChildProcess } from "node:child_process";

import { decodeDisplayTextResponses } from "../protocol/responses/text-display.js";
import { type AgdaVersion, parseAgdaVersion } from "./agda-version.js";
import { logger } from "./logger.js";
import { type AgdaTransport, ControlCommandInterruption } from "../session/agda-transport.js";
import { topLevelCommand } from "../protocol/command-builder.js";
import type { AgdaResponse } from "./types.js";

/**
 * Inner Agda command for the version probe. Materialized once so the
 * regression fence in `test/unit/protocol/no-bare-command-strings.ts`
 * doesn't have to special-case the call site, and so the typed builder
 * remains the single source of truth for the wire string.
 */
const SHOW_VERSION_COMMAND = topLevelCommand("Cmd_show_version");

/**
 * Hard cap on how many `Cmd_show_version` round-trips a session will
 * attempt before giving up on detection. Every retry costs an inline
 * pre-flight before some user command, so the value should be small.
 * Three matches the historical `AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS`.
 */
export const VERSION_DETECTION_MAX_ATTEMPTS = 3;

/**
 * Per-attempt timeout for the pre-flight version round-trip. Longer
 * than a typical Agda command because the very first probe also pays
 * the process spawn cost, but short enough to fail fast if the binary
 * is wedged.
 */
export const VERSION_DETECTION_TIMEOUT_MS = 15_000;

/**
 * Mutable state the detector reads/writes on the host session. Kept
 * as a structural interface so the helper can run against either the
 * real `AgdaSession` or a stub in unit tests.
 */
export interface VersionDetectionState {
  detectedVersion: AgdaVersion | null;
  versionDetectionAttempts: number;
}

/**
 * Pull the version string out of a Cmd_show_version response stream,
 * if present. Filters strictly to `kind === "DisplayInfo"` /
 * `info.kind === "Version"` to avoid mis-parsing timing output.
 */
export function extractRawVersionString(responses: AgdaResponse[]): string | undefined {
  const { text } = decodeDisplayTextResponses(responses, {
    infoKinds: ["Version"],
    position: "first",
  });
  return text || undefined;
}

/**
 * Run the pre-flight version round-trip if detection is still pending
 * and the user command isn't itself `Cmd_show_version`. Returns the
 * (possibly-updated) detection state. Best-effort — failures consume
 * an attempt slot but never throw upward, so the user's command is
 * never blocked by a flaky version probe.
 */
export async function preflightVersionDetection(args: {
  state: VersionDetectionState;
  transport: AgdaTransport;
  proc: ChildProcess;
  buildIotcm: (cmd: string) => string;
  userCommand: string;
}): Promise<void> {
  const needsDetection =
    args.state.detectedVersion === null &&
    args.state.versionDetectionAttempts < VERSION_DETECTION_MAX_ATTEMPTS;
  if (!needsDetection) return;
  if (args.userCommand.includes("Cmd_show_version")) return;

  args.state.versionDetectionAttempts++;
  try {
    const vCmd = args.buildIotcm(SHOW_VERSION_COMMAND);
    const responses = await args.transport.sendCommand(
      args.proc,
      vCmd,
      VERSION_DETECTION_TIMEOUT_MS,
    );
    const raw = extractRawVersionString(responses);
    if (raw) {
      try {
        args.state.detectedVersion = parseAgdaVersion(raw);
        logger.trace("detected Agda version", {
          version: args.state.detectedVersion,
        });
      } catch {
        // Could not parse version string; attempt slot consumed,
        // retry will happen on the next command if under the limit.
      }
    }
  } catch (err) {
    // Best-effort — most transport errors here are transient probe
    // failures, so we swallow them and let the next user command
    // retry detection (up to VERSION_DETECTION_MAX_ATTEMPTS).
    //
    // EXCEPTION: a `ControlCommandInterruption` means the caller
    // fired `Cmd_abort`/`Cmd_exit` while the preflight was in
    // flight. Swallowing it would let the user command proceed and
    // the queued abort wait its turn behind it — defeating the
    // protocol-level intent of `Cmd_abort`. Re-throw so
    // `session.sendCommand` rejects the user command and the
    // queued control command can run.
    if (err instanceof ControlCommandInterruption) throw err;
  }
}

/**
 * Piggyback path: when the user's command WAS `Cmd_show_version` and
 * detection was still pending, extract the version from those same
 * responses so we avoid an extra round-trip.
 */
export function piggybackVersionFromResponses(args: {
  state: VersionDetectionState;
  responses: AgdaResponse[];
  userCommand: string;
}): void {
  const wasPending =
    args.state.detectedVersion === null &&
    args.state.versionDetectionAttempts < VERSION_DETECTION_MAX_ATTEMPTS;
  if (!wasPending) return;
  if (!args.userCommand.includes("Cmd_show_version")) return;

  args.state.versionDetectionAttempts++;
  try {
    const raw = extractRawVersionString(args.responses);
    if (raw) {
      args.state.detectedVersion = parseAgdaVersion(raw);
      logger.trace("detected Agda version (piggybacked)", {
        version: args.state.detectedVersion,
      });
    }
  } catch (err) {
    // Attempt slot consumed; retry on next command if under the limit.
    logger.trace("version detection piggyback failed", { err });
  }
}
