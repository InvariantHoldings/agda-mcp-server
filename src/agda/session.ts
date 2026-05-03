// MIT License — see LICENSE
//
// Stateful Agda interaction process manager
//
// Manages a long-running Agda process using --interaction-json mode.
// Agda's IOTCM protocol is stateful: after Cmd_load, interaction points
// (goals) are assigned integer IDs that persist for subsequent commands
// like Cmd_goal_type_context, Cmd_make_case, Cmd_give, etc.
//
// Protocol reference:
//   Input:  IOTCM "<filepath>" NonInteractive Direct (<command>)
//   Output: Newline-delimited JSON with "kind" field
//   Commands: Cmd_load, Cmd_metas, Cmd_goal_type_context, Cmd_make_case,
//             Cmd_give, Cmd_refine_or_intro, Cmd_auto, Cmd_compute,
//             Cmd_infer, Cmd_constraints, Cmd_solveAll
//
// Architecture:
//   This file owns process lifecycle and the IOTCM transport layer.
//   Domain-specific command logic is delegated to:
//     goal-operations.ts       — goal type/context, case split, give, refine, auto, metas
//     expression-operations.ts — compute, infer (goal-level and top-level)
//     advanced-queries.ts      — constraints, solve, scope, elaborate, modules, search
//     display-operations.ts    — highlighting and display toggles
//     backend-operations.ts    — compile and backend payload commands

import { spawn, ChildProcess } from "node:child_process";
import { deriveSessionPhase, type SessionPhase } from "../session/session-state.js";
import {
  configuredCommandTimeoutMs,
} from "../session/command-completion.js";
import { AgdaTransport } from "../session/agda-transport.js";
import { extractGoalIdsFromResponses } from "../session/goal-state.js";
import { createSessionNamespaces } from "../session/session-namespaces.js";
import {
  createLibraryRegistration,
  type LibraryRegistration,
} from "./library-registration.js";
import type {
  AgdaResponse,
  LoadResult,
} from "./types.js";
import { logger } from "./logger.js";
import { type AgdaVersion, parseAgdaVersion } from "./agda-version.js";
import { decodeDisplayTextResponses } from "../protocol/responses/text-display.js";
import { findAgdaBinary } from "./binary-discovery.js";
import { runLoad, runLoadNoMetas } from "./session-load-impl.js";
import {
  effectiveProjectFlags,
  loadProjectConfig,
  mergeCommandLineOptions,
} from "../session/project-config.js";
import { statSync } from "node:fs";

export { findAgdaBinary };

// ── Agda Session ──────────────────────────────────────────────────────

/**
 * A stateful Agda interaction session.
 *
 * Spawns `agda --interaction-json` and keeps it alive. Commands are sent
 * via stdin as IOTCM strings; JSON responses are collected from stdout
 * until a "status" response signals command completion.
 *
 * Domain-specific command logic is delegated to standalone functions in
 * goal-operations, expression-operations, and advanced-queries modules.
 * This class implements AgdaSessionContext implicitly so delegate
 * functions can access the shared transport and state.
 */
export class AgdaSession {
  proc: ChildProcess | null = null;
  repoRoot: string;
  currentFile: string | null = null;
  goalIds: number[] = [];
  exiting = false;
  private detectedVersion: AgdaVersion | null = null;
  private versionDetectionAttempts = 0;
  static readonly VERSION_DETECTION_MAX_ATTEMPTS = 3;
  private static readonly VERSION_DETECTION_TIMEOUT_MS = 15_000;
  // The three load-history fields below are exposed to the sibling
  // session-load-impl.ts so the runLoad / runLoadNoMetas helpers can
  // update session state after a Cmd_load completes. External
  // consumers should read them via the getters (isFileStale,
  // getLastClassification, getLastLoadedAt) rather than touching
  // them directly.
  lastLoadedMtime: number | null = null;
  lastClassification: string | null = null;
  lastLoadedAt: number | null = null;
  lastInvisibleGoalCount = 0;
  private libraryRegistration: LibraryRegistration | null = null;
  private readonly transport = new AgdaTransport();
  private commandQueue: Promise<unknown> = Promise.resolve();
  readonly goal;
  readonly expr;
  readonly query;
  readonly display;
  readonly backend;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    const namespaces = createSessionNamespaces(this);
    this.goal = namespaces.goal;
    this.expr = namespaces.expr;
    this.query = namespaces.query;
    this.display = namespaces.display;
    this.backend = namespaces.backend;
  }

  /** Check if the loaded file has been modified on disk since last load. */
  isFileStale(): boolean {
    if (!this.currentFile) return false;
    try {
      const current = statSync(this.currentFile).mtimeMs;
      return this.lastLoadedMtime !== null && current !== this.lastLoadedMtime;
    } catch {
      return true; // file deleted = stale
    }
  }

  /** Start the Agda process if not already running. */
  ensureProcess(): ChildProcess {
    if (this.proc && this.proc.exitCode === null) {
      return this.proc;
    }

    // Process died or never started — reset stale state
    this.currentFile = null;
    this.goalIds = [];
    this.lastInvisibleGoalCount = 0;

    const agdaBin = findAgdaBinary(this.repoRoot);
    const registration = this.getLibraryRegistration();
    this.proc = spawn(agdaBin, ["--interaction-json", ...registration.agdaArgs], {
      cwd: this.repoRoot,
      env: { ...process.env, AGDA_DIR: registration.agdaDir },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.transport.handleStdout(chunk);
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      this.transport.handleStderr(chunk);
    });

    this.proc.on("close", () => {
      this.proc = null;
      this.currentFile = null;
      this.goalIds = [];
      this.lastLoadedMtime = null;
      this.lastClassification = null;
      this.lastLoadedAt = null;
      this.lastInvisibleGoalCount = 0;
      this.exiting = false;
      // Reset version detection so the next process start re-detects cleanly.
      this.detectedVersion = null;
      this.versionDetectionAttempts = 0;
      this.transport.handleProcessClose();
    });

    this.proc.on("error", (err) => {
      this.transport.handleProcessError(err);
    });

    return this.proc;
  }

  private getLibraryRegistration(): LibraryRegistration {
    if (!this.libraryRegistration) {
      this.libraryRegistration = createLibraryRegistration(this.repoRoot);
    }
    return this.libraryRegistration;
  }

  /**
   * Scan responses from Cmd_show_version and return the version string, or
   * undefined if no Version DisplayInfo response is present.
   *
   * Filters strictly to `kind === "DisplayInfo"` / `info.kind === "Version"`
   * responses to avoid mis-parsing timing output or other messages as
   * version strings. Reuses the same decoder that `showVersion()` uses.
   */
  private static extractRawVersionString(responses: AgdaResponse[]): string | undefined {
    const { text } = decodeDisplayTextResponses(responses, {
      infoKinds: ["Version"],
      position: "first",
    });
    return text || undefined;
  }

  /**
   * Send an IOTCM command and collect responses until completion.
   * Returns all JSON responses received during this command.
   *
   * Commands are serialized via a promise queue so that concurrent MCP
   * tool calls never interleave on the single-process Agda stdin/stdout.
   *
   * Version detection runs inline before the first real command so that
   * `getAgdaVersion()` is populated for every caller, including the one
   * that triggers the first command.
   */
  sendCommand(
    command: string,
    timeoutMs = configuredCommandTimeoutMs(),
  ): Promise<AgdaResponse[]> {
    const task = this.commandQueue.then(async () => {
      const proc = this.ensureProcess();

      // Detect Agda version inline before the user command so that
      // getAgdaVersion() is populated for the current command's callers.
      // Retry on transient failures up to VERSION_DETECTION_MAX_ATTEMPTS.
      //
      // Special case: if the user command itself is Cmd_show_version, skip
      // the pre-flight round-trip and instead extract the version from the
      // actual command's responses (one round-trip instead of two).
      const needsDetection =
        this.detectedVersion === null &&
        this.versionDetectionAttempts < AgdaSession.VERSION_DETECTION_MAX_ATTEMPTS;
      const commandIsVersionQuery = command.includes("Cmd_show_version");

      if (needsDetection && !commandIsVersionQuery) {
        this.versionDetectionAttempts++;
        try {
          const vCmd = this.iotcm("Cmd_show_version");
          const responses = await this.transport.sendCommand(
            proc,
            vCmd,
            AgdaSession.VERSION_DETECTION_TIMEOUT_MS,
          );
          const raw = AgdaSession.extractRawVersionString(responses);
          if (raw) {
            try {
              this.detectedVersion = parseAgdaVersion(raw);
              logger.trace("detected Agda version", {
                version: this.detectedVersion,
              });
            } catch {
              // Could not parse version string; attempt slot consumed,
              // retry will happen on the next command if under the limit.
            }
          }
        } catch {
          // Best-effort — command error consumes an attempt slot; will retry
          // on subsequent commands up to VERSION_DETECTION_MAX_ATTEMPTS.
        }
      }

      const responses = await this.transport.sendCommand(proc, command, timeoutMs);

      // Piggyback: when the user command was Cmd_show_version and detection
      // was still pending, extract the version from those responses so we avoid
      // an extra round-trip on the first agda_show_version invocation.
      if (needsDetection && commandIsVersionQuery) {
        this.versionDetectionAttempts++;
        try {
          const raw = AgdaSession.extractRawVersionString(responses);
          if (raw) {
            this.detectedVersion = parseAgdaVersion(raw);
            logger.trace("detected Agda version (piggybacked)", {
              version: this.detectedVersion,
            });
          }
        } catch (err) {
          // Attempt slot consumed; retry on next command if under the limit.
          logger.trace("version detection piggyback failed", { err });
        }
      }

      return responses;
    });
    // Chain onto the queue — swallow rejections so a failed command
    // doesn't block subsequent commands from executing.
    this.commandQueue = task.then(() => { }, () => { });
    return task;
  }

  /**
   * Build an IOTCM command string.
   * Format: IOTCM "<filepath>" NonInteractive Direct (<agda-command>)
   */
  iotcm(agdaCmd: string): string {
    const fp = this.currentFile ?? "";
    return `IOTCM "${fp}" NonInteractive Direct (${agdaCmd})`;
  }

  /** Get the currently loaded file path, or throw if none loaded. */
  requireFile(): string {
    if (!this.currentFile) {
      throw new Error("No file loaded. Call load() first.");
    }
    return this.currentFile;
  }

  syncGoalIdsFromResponses(responses: AgdaResponse[]): void {
    const goalIds = extractGoalIdsFromResponses(responses);
    if (goalIds !== null) {
      this.goalIds = goalIds;
    }
  }

  private buildIotcm(filePath: string, agdaCmd: string): string {
    return `IOTCM "${filePath}" NonInteractive Direct (${agdaCmd})`;
  }

  /**
   * Build an IOTCM command string for a specific file path, bypassing
   * the session's currentFile. Used by the extracted load helpers
   * (session-load-impl.ts) which need to construct the Cmd_load
   * invocation before assigning currentFile — assigning earlier would
   * race with ensureProcess()'s stale-state reset path.
   */
  iotcmFor(filePath: string, agdaCmd: string): string {
    return this.buildIotcm(filePath, agdaCmd);
  }

  private async runIndependentCommand(
    agdaCmd: string,
    timeoutMs = 120_000,
  ): Promise<AgdaResponse[]> {
    return this.sendCommand(this.buildIotcm(this.currentFile ?? "", agdaCmd), timeoutMs);
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Load (type-check) a file. This is always the first command — it
   * establishes the interaction state and assigns goal IDs. The
   * implementation lives in session-load-impl.ts so this file stays
   * focused on the class and its lifecycle; both load() and
   * loadNoMetas() are thin delegators here.
   *
   * Project-level defaults (`.agda-mcp.json` + `AGDA_MCP_DEFAULT_FLAGS`)
   * are merged in HERE, not at the tool boundary, so EVERY caller of
   * `session.load()` — including `agda_apply_edit`'s post-edit reload,
   * `agda_bulk_status`, and any future tool — picks them up
   * consistently. The merged warnings ride back on
   * `LoadResult.projectConfigWarnings` so callers can surface them.
   *
   * @param filePath  Path to the Agda file (relative or absolute).
   * @param options   Optional settings for the load command.
   * @param options.profileOptions  Agda profile options (e.g.
   *   ["modules", "sharing"]). These are passed as `--profile=xxx` in
   *   the Cmd_load options list.
   * @param options.commandLineOptions  Per-call Agda command-line flags
   *   (e.g. ["--Werror", "--safe"]). MERGED with project config + env
   *   defaults; per-call values win on collision via last-wins dedup.
   */
  async load(
    filePath: string,
    options?: { profileOptions?: string[]; commandLineOptions?: string[] },
  ): Promise<LoadResult> {
    const projectConfig = loadProjectConfig(this.repoRoot);
    const merged = mergeCommandLineOptions(
      effectiveProjectFlags(projectConfig),
      options?.commandLineOptions,
    );
    const result = await runLoad(this, filePath, {
      profileOptions: options?.profileOptions,
      commandLineOptions: merged.length > 0 ? merged : undefined,
    });
    if (projectConfig.warnings.length > 0) {
      return { ...result, projectConfigWarnings: projectConfig.warnings };
    }
    return result;
  }

  async loadNoMetas(filePath: string): Promise<LoadResult> {
    return runLoadNoMetas(this, filePath);
  }

  async compile(
    backendExpr: string,
    filePath: string,
    argv: string[] = [],
  ) {
    return this.backend.compile(backendExpr, filePath, argv);
  }

  async backendTop(
    backendExpr: string,
    payload: string,
  ) {
    return this.backend.top(backendExpr, payload);
  }

  async backendHole(
    goalId: number,
    holeContents: string,
    backendExpr: string,
    payload: string,
  ) {
    return this.backend.hole(goalId, holeContents, backendExpr, payload);
  }

  /** Send Cmd_abort to the running Agda process. */
  async abort(): Promise<AgdaResponse[]> {
    return this.runIndependentCommand("Cmd_abort", 10_000);
  }

  /** Send Cmd_exit to the running Agda process. */
  async exit(): Promise<AgdaResponse[]> {
    this.exiting = true;
    return this.runIndependentCommand("Cmd_exit", 10_000);
  }

  // ── Accessors ─────────────────────────────────────────────────────

  /**
   * Get the detected Agda version, or null if not yet detected.
   * Populated by the inline version detection that runs before each
   * command (once per process lifecycle). Callers within a command
   * handler can rely on this being set if detection succeeded.
   */
  getAgdaVersion(): AgdaVersion | null {
    return this.detectedVersion;
  }

  /** Get current goal IDs. */
  getGoalIds(): number[] {
    return [...this.goalIds];
  }

  /** Get the currently loaded file. */
  getLoadedFile(): string | null {
    return this.currentFile;
  }

  /**
   * Classification from the most recent load attempt, if any. Set by
   * load() and loadNoMetas() for every attempt — success, failure, and
   * type-error alike — so callers distinguishing "regression from
   * ok-complete" from "still failing" both have a previous-state anchor.
   * Reset on session destroy and on Agda process death.
   */
  getLastClassification(): string | null {
    return this.lastClassification;
  }

  /** Get the wall-clock time (epoch ms) of the most recent load, if any. */
  getLastLoadedAt(): number | null {
    return this.lastLoadedAt;
  }

  /** Get the invisible goal count from the most recent load. */
  getInvisibleGoalCount(): number {
    return this.lastInvisibleGoalCount;
  }

  /** Get the current high-level session phase. */
  getPhase(): SessionPhase {
    return deriveSessionPhase({
      hasProcess: this.proc !== null && this.proc.exitCode === null,
      hasLoadedFile: this.currentFile !== null,
      isCollecting: this.collecting,
      isExiting: this.exiting,
    });
  }

  /** Kill the Agda process and reset state. */
  destroy(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.libraryRegistration?.cleanup();
    this.libraryRegistration = null;
    this.currentFile = null;
    this.goalIds = [];
    this.lastLoadedMtime = null;
    this.lastClassification = null;
    this.lastLoadedAt = null;
    this.lastInvisibleGoalCount = 0;
    this.detectedVersion = null;
    this.versionDetectionAttempts = 0;
    this.transport.destroy();
    this.commandQueue = Promise.resolve();
    this.exiting = false;
  }

  get buffer(): string {
    return this.transport.buffer;
  }

  set buffer(value: string) {
    this.transport.buffer = value;
  }

  get responseQueue(): AgdaResponse[] {
    return this.transport.responseQueue;
  }

  set responseQueue(value: AgdaResponse[]) {
    this.transport.responseQueue = value;
  }

  get emitter() {
    return this.transport.emitter;
  }

  get collecting(): boolean {
    return this.transport.collecting;
  }

  set collecting(value: boolean) {
    this.transport.collecting = value;
  }
}
