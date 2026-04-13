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
import { findAgdaBinary } from "./binary-discovery.js";
import { runLoad, runLoadNoMetas } from "./session-load-impl.js";
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
  // The three load-history fields below are exposed to the sibling
  // session-load-impl.ts so the runLoad / runLoadNoMetas helpers can
  // update session state after a Cmd_load completes. External
  // consumers should read them via the getters (isFileStale,
  // getLastClassification, getLastLoadedAt) rather than touching
  // them directly.
  lastLoadedMtime: number | null = null;
  lastClassification: string | null = null;
  lastLoadedAt: number | null = null;
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
      this.exiting = false;
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
   * Send an IOTCM command and collect responses until completion.
   * Returns all JSON responses received during this command.
   *
   * Commands are serialized via a promise queue so that concurrent MCP
   * tool calls never interleave on the single-process Agda stdin/stdout.
   */
  sendCommand(
    command: string,
    timeoutMs = configuredCommandTimeoutMs(),
  ): Promise<AgdaResponse[]> {
    const task = this.commandQueue.then(() => {
      const proc = this.ensureProcess();
      return this.transport.sendCommand(proc, command, timeoutMs);
    });
    // Chain onto the queue — swallow rejections so a failed command
    // doesn't block subsequent commands from executing.
    this.commandQueue = task.then(() => {}, () => {});
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
   * @param filePath  Path to the Agda file (relative or absolute).
   * @param options   Optional settings for the load command.
   * @param options.profileOptions  Agda profile options (e.g.
   *   ["modules", "sharing"]). These are passed as `--profile=xxx` in
   *   the Cmd_load options list.
   */
  async load(
    filePath: string,
    options?: { profileOptions?: string[] },
  ): Promise<LoadResult> {
    return runLoad(this, filePath, options);
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
