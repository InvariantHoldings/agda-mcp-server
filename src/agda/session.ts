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
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
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
  AgdaGoal,
  LoadResult,
} from "./types.js";
import { parseLoadResponses } from "./parse-load-responses.js";
import { logger } from "./logger.js";
import { command, quoted, stringList } from "../protocol/command-builder.js";
import {
  validateProfileOptions,
  toProfileArgs,
  type ProfileOption,
} from "../protocol/profile-options.js";

// ── Binary discovery ──────────────────────────────────────────────────

/**
 * Find the repo-pinned Agda binary.
 */
export function findAgdaBinary(repoRoot: string): string {
  if (process.env.AGDA_BIN) {
    return process.env.AGDA_BIN;
  }
  const pinned = resolve(repoRoot, "tooling/scripts/run-pinned-agda.sh");
  if (existsSync(pinned)) {
    return pinned;
  }
  return "agda";
}

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
  private lastLoadedMtime: number | null = null;
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

  private async runIndependentCommand(
    agdaCmd: string,
    timeoutMs = 120_000,
  ): Promise<AgdaResponse[]> {
    return this.sendCommand(this.buildIotcm(this.currentFile ?? "", agdaCmd), timeoutMs);
  }

  // ── Public API ────────────────────────────────────────────────────

  private static readonly NOT_FOUND_RESULT: LoadResult = Object.freeze({
    success: false, errors: [], warnings: [], goals: [],
    allGoalsText: "", invisibleGoalCount: 0,
    goalCount: 0, hasHoles: false, isComplete: false,
    classification: "type-error",
    profiling: null,
  });

  private mergeGoals(
    primaryGoals: AgdaGoal[],
    secondaryGoals: AgdaGoal[],
  ): AgdaGoal[] {
    const merged = new Map<number, AgdaGoal>();

    for (const goal of primaryGoals) {
      merged.set(goal.goalId, { ...goal, context: [...goal.context] });
    }

    for (const goal of secondaryGoals) {
      const existing = merged.get(goal.goalId);
      if (!existing) {
        merged.set(goal.goalId, { ...goal, context: [...goal.context] });
        continue;
      }

      if (existing.type === "?" && goal.type !== "?") {
        existing.type = goal.type;
      }

      if (existing.context.length === 0 && goal.context.length > 0) {
        existing.context = [...goal.context];
      }
    }

    return [...merged.values()].sort((left, right) => left.goalId - right.goalId);
  }

  /**
   * Load (type-check) a file. This is always the first command — it
   * establishes the interaction state and assigns goal IDs.
   *
   * @param filePath  Path to the Agda file (relative or absolute).
   * @param options   Optional settings for the load command.
   * @param options.profileOptions  Agda profile options (e.g. ["modules", "sharing"]).
   *   These are passed as `--profile=xxx` in the Cmd_load options list.
   */
  async load(
    filePath: string,
    options?: { profileOptions?: string[] },
  ): Promise<LoadResult> {
    const absPath = resolve(this.repoRoot, filePath);
    if (!existsSync(absPath)) {
      return {
        ...AgdaSession.NOT_FOUND_RESULT,
        errors: [`File not found: ${absPath}`],
      };
    }

    // Build the command-line options list for Cmd_load
    let optsList = "[]";
    if (options?.profileOptions && options.profileOptions.length > 0) {
      const validation = validateProfileOptions(options.profileOptions);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          warnings: [],
          goals: [],
          allGoalsText: "",
          invisibleGoalCount: 0,
          goalCount: 0,
          hasHoles: false,
          isComplete: false,
          classification: "invalid-profile-options",
          profiling: null,
        };
      }
      const profileArgs = toProfileArgs(validation.options);
      optsList = stringList(profileArgs);
    }

    // Use buildIotcm with absPath directly — don't set currentFile yet
    // because ensureProcess() (called inside sendCommand) resets it
    const responses = await this.sendCommand(
      this.buildIotcm(absPath, command("Cmd_load", quoted(absPath), optsList)),
    );
    const profilingEnabled = (options?.profileOptions?.length ?? 0) > 0;
    const parsed = parseLoadResponses(responses, { profilingEnabled });

    // Set session state before reconciling metas so follow-up queries can run
    this.currentFile = absPath;
    this.goalIds = parsed.goalIds;
    this.lastLoadedMtime = statSync(absPath).mtimeMs;

    let goals = parsed.goals;
    let goalIds = parsed.goalIds;

    if (parsed.success) {
      try {
        const metas = await this.goal.metas();
        if (metas.goals.length > 0) {
          goals = this.mergeGoals(parsed.goals, metas.goals);
          goalIds = goals.map((goal) => goal.goalId);
        }
      } catch (err) {
        logger.warn("post-load metas reconciliation failed", {
          file: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const goalCount = goals.length;
    const hasHoles = goalCount > 0 || parsed.invisibleGoalCount > 0;
    const isComplete = parsed.success && !hasHoles;
    const classification = parsed.success
      ? hasHoles
        ? "ok-with-holes"
        : "ok-complete"
      : "type-error";

    this.goalIds = goalIds;

    logger.trace("load complete", {
      file: absPath,
      success: parsed.success,
      goals: goals.length,
      errors: parsed.errors.length,
    });

    return {
      success: parsed.success,
      errors: parsed.errors,
      warnings: parsed.warnings,
      goals,
      allGoalsText: parsed.allGoalsText,
      invisibleGoalCount: parsed.invisibleGoalCount,
      goalCount,
      hasHoles,
      isComplete,
      classification,
      profiling: parsed.profiling,
    };
  }

  async loadNoMetas(filePath: string): Promise<LoadResult> {
    const absPath = resolve(this.repoRoot, filePath);
    if (!existsSync(absPath)) {
      return {
        ...AgdaSession.NOT_FOUND_RESULT,
        errors: [`File not found: ${absPath}`],
      };
    }

    const responses = await this.sendCommand(
      this.buildIotcm(absPath, command("Cmd_load_no_metas", quoted(absPath))),
    );
    const parsed = parseLoadResponses(responses, { profilingEnabled: false });

    // Set session state atomically AFTER command completes
    this.currentFile = absPath;
    this.goalIds = parsed.goalIds;
    this.lastLoadedMtime = statSync(absPath).mtimeMs;

    return {
      success: parsed.success,
      errors: parsed.errors,
      warnings: parsed.warnings,
      goals: parsed.goals,
      allGoalsText: parsed.allGoalsText,
      invisibleGoalCount: parsed.invisibleGoalCount,
      goalCount: parsed.goalCount,
      hasHoles: parsed.hasHoles,
      isComplete: parsed.isComplete,
      classification: parsed.classification,
      profiling: parsed.profiling,
    };
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
