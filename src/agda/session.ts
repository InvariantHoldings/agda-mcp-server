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
import { EventEmitter } from "node:events";
import { deriveSessionPhase, type SessionPhase } from "../session/session-state.js";
import type {
  AgdaResponse,
  AgdaGoal,
  LoadResult,
} from "./types.js";
// response-parsing.js is used by delegate modules, not directly here
import { normalizeAgdaResponse } from "./normalize-response.js";
import { parseLoadResponses } from "./parse-load-responses.js";
import { logger } from "./logger.js";

// Delegate modules
import * as GoalOps from "./goal-operations.js";
import * as ExprOps from "./expression-operations.js";
import * as AdvancedOps from "./advanced-queries.js";
import * as DisplayOps from "./display-operations.js";
import * as BackendOps from "./backend-operations.js";

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
  buffer = "";
  responseQueue: AgdaResponse[] = [];
  emitter = new EventEmitter();
  collecting = false;
  exiting = false;
  private lastLoadedMtime: number | null = null;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
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
    this.proc = spawn(agdaBin, ["--interaction-json"], {
      cwd: this.repoRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.drainBuffer();
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      // Agda prints progress/warnings to stderr — capture for diagnostics
      const text = chunk.toString();
      if (this.collecting) {
        this.responseQueue.push({
          kind: "StderrOutput",
          text,
        });
      }
    });

    this.proc.on("close", () => {
      this.proc = null;
      this.currentFile = null;
      this.goalIds = [];
      this.exiting = false;
      // Signal any waiting command
      this.emitter.emit("done");
    });

    this.proc.on("error", (err) => {
      this.emitter.emit("error", err);
    });

    return this.proc;
  }

  /**
   * Parse newline-delimited JSON from the stdout buffer.
   * Uses indexOf-based scanning instead of split() so we only
   * process new data on each chunk — O(n) total, not O(n²).
   */
  private drainBuffer(): void {
    let start = 0;
    let newlineIdx: number;

    while ((newlineIdx = this.buffer.indexOf("\n", start)) !== -1) {
      const line = this.buffer.slice(start, newlineIdx).trim();
      start = newlineIdx + 1;

      if (!line) continue;

      // Agda may emit non-JSON preamble lines (e.g. "Agda2>")
      if (!line.startsWith("{") && !line.startsWith("[")) continue;

      try {
        const resp: AgdaResponse = normalizeAgdaResponse(JSON.parse(line));
        if (this.collecting) {
          this.responseQueue.push(resp);
        }

        // A Status response signals command completion
        if (resp.kind === "Status") {
          this.emitter.emit("done");
        }
        // ClearRunningInfo can also signal end of response
        if (resp.kind === "ClearRunningInfo") {
          setTimeout(() => this.emitter.emit("done"), 100);
        }
      } catch {
        logger.trace("Skipped unparseable line", { line: line.slice(0, 120) });
      }
    }

    // Keep only the unparsed remainder
    if (start > 0) {
      this.buffer = this.buffer.slice(start);
    }
  }

  /**
   * Send an IOTCM command and collect responses until completion.
   * Returns all JSON responses received during this command.
   */
  sendCommand(
    command: string,
    timeoutMs = 120_000,
  ): Promise<AgdaResponse[]> {
    const proc = this.ensureProcess();
    logger.trace("sendCommand", { command: command.slice(0, 200), timeoutMs });
    const startTime = Date.now();

    this.responseQueue = [];
    this.collecting = true;

    return new Promise<AgdaResponse[]>((resolveCmd, rejectCmd) => {
      const timeout = setTimeout(() => {
        logger.warn("sendCommand timed out", { command: command.slice(0, 100), timeoutMs });
        this.collecting = false;
        resolveCmd([...this.responseQueue]);
      }, timeoutMs);

      const onDone = () => {
        // Wait briefly for any trailing responses
        setTimeout(() => {
          clearTimeout(timeout);
          this.collecting = false;
          this.emitter.removeListener("done", onDone);
          this.emitter.removeListener("error", onError);
          const responses = [...this.responseQueue];
          logger.trace("sendCommand done", { responses: responses.length, durationMs: Date.now() - startTime });
          resolveCmd(responses);
        }, 200);
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        this.collecting = false;
        this.emitter.removeListener("done", onDone);
        rejectCmd(err);
      };

      this.emitter.on("done", onDone);
      this.emitter.on("error", onError);

      proc.stdin?.write(command + "\n");
    });
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
    allGoalsText: "", invisibleGoalCount: 0, raw: [],
  });

  /**
   * Load (type-check) a file. This is always the first command — it
   * establishes the interaction state and assigns goal IDs.
   */
  async load(filePath: string): Promise<LoadResult> {
    const absPath = resolve(this.repoRoot, filePath);
    if (!existsSync(absPath)) {
      return {
        ...AgdaSession.NOT_FOUND_RESULT,
        errors: [`File not found: ${absPath}`],
      };
    }

    this.currentFile = absPath;

    const cmd = this.iotcm(`Cmd_load "${absPath}" []`);
    const responses = await this.sendCommand(cmd);
    const parsed = parseLoadResponses(responses);

    // Atomic assignment — no window where goalIds is empty
    this.goalIds = parsed.goalIds;
    this.lastLoadedMtime = statSync(absPath).mtimeMs;

    logger.trace("load complete", {
      file: absPath,
      success: parsed.success,
      goals: parsed.goals.length,
      errors: parsed.errors.length,
    });

    return {
      success: parsed.success,
      errors: parsed.errors,
      warnings: parsed.warnings,
      goals: parsed.goals,
      allGoalsText: parsed.allGoalsText,
      invisibleGoalCount: parsed.invisibleGoalCount,
      raw: responses,
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

    this.currentFile = absPath;

    const responses = await this.sendCommand(
      this.buildIotcm(absPath, `Cmd_load_no_metas "${absPath}"`),
    );
    const parsed = parseLoadResponses(responses);

    // Atomic assignment
    this.goalIds = parsed.goalIds;
    this.lastLoadedMtime = statSync(absPath).mtimeMs;

    return {
      success: parsed.success,
      errors: parsed.errors,
      warnings: parsed.warnings,
      goals: parsed.goals,
      allGoalsText: parsed.allGoalsText,
      invisibleGoalCount: parsed.invisibleGoalCount,
      raw: responses,
    };
  }

  // ── Grouped command namespaces ──────────────────────────────────

  /** Goal interaction commands. */
  readonly goal = Object.freeze({
    typeContext: (id: number) => GoalOps.goalTypeContext(this, id),
    type: (id: number) => GoalOps.goalType(this, id),
    context: (id: number) => GoalOps.context(this, id),
    typeContextCheck: (id: number, expr: string) => GoalOps.goalTypeContextCheck(this, id, expr),
    caseSplit: (id: number, variable: string) => GoalOps.caseSplit(this, id, variable),
    give: (id: number, expr: string) => GoalOps.give(this, id, expr),
    refine: (id: number, expr: string) => GoalOps.refine(this, id, expr),
    refineExact: (id: number, expr: string) => GoalOps.refineExact(this, id, expr),
    intro: (id: number, expr?: string) => GoalOps.intro(this, id, expr),
    autoOne: (id: number) => GoalOps.autoOne(this, id),
    metas: () => GoalOps.metas(this),
  });

  /** Expression-level commands. */
  readonly expr = Object.freeze({
    compute: (id: number, expr: string) => ExprOps.compute(this, id, expr),
    computeTopLevel: (expr: string) => ExprOps.computeTopLevel(this, expr),
    infer: (id: number, expr: string) => ExprOps.infer(this, id, expr),
    inferTopLevel: (expr: string) => ExprOps.inferTopLevel(this, expr),
  });

  /** Advanced queries: constraints, scope, solve, elaborate, modules, search. */
  readonly query = Object.freeze({
    constraints: () => AdvancedOps.constraints(this),
    solveAll: () => AdvancedOps.solveAll(this),
    solveOne: (goalId: number) => AdvancedOps.solveOne(this, goalId),
    whyInScope: (goalId: number, name: string) => AdvancedOps.whyInScope(this, goalId, name),
    whyInScopeTopLevel: (name: string) => AdvancedOps.whyInScopeTopLevel(this, name),
    elaborate: (goalId: number, expr: string) => AdvancedOps.elaborate(this, goalId, expr),
    helperFunction: (goalId: number, expr: string) => AdvancedOps.helperFunction(this, goalId, expr),
    showModuleContents: (goalId: number, moduleName: string) => AdvancedOps.showModuleContents(this, goalId, moduleName),
    showModuleContentsTopLevel: (moduleName: string) => AdvancedOps.showModuleContentsTopLevel(this, moduleName),
    searchAbout: (query: string) => AdvancedOps.searchAbout(this, query),
    autoAll: () => AdvancedOps.autoAll(this),
    showVersion: () => AdvancedOps.showVersion(this),
    goalTypeContextInfer: (goalId: number, expr: string) => AdvancedOps.goalTypeContextInfer(this, goalId, expr),
  });

  /** Display and highlighting controls. */
  readonly display = Object.freeze({
    loadHighlightingInfo: (filePath: string) => DisplayOps.loadHighlightingInfo(this, filePath),
    tokenHighlighting: (filePath: string, remove?: boolean) => DisplayOps.tokenHighlighting(this, filePath, remove),
    highlight: (goalId: number, expr: string) => DisplayOps.highlight(this, goalId, expr),
    showImplicitArgs: (show: boolean) => DisplayOps.showImplicitArgs(this, show),
    toggleImplicitArgs: () => DisplayOps.toggleImplicitArgs(this),
    showIrrelevantArgs: (show: boolean) => DisplayOps.showIrrelevantArgs(this, show),
    toggleIrrelevantArgs: () => DisplayOps.toggleIrrelevantArgs(this),
  });

  /** Backend and compilation commands. */
  readonly backend = Object.freeze({
    compile: (backendExpr: string, filePath: string, argv?: string[]) => BackendOps.compile(this, backendExpr, filePath, argv ?? []),
    top: (backendExpr: string, payload: string) => BackendOps.backendTop(this, backendExpr, payload),
    hole: (goalId: number, holeContents: string, backendExpr: string, payload: string) => BackendOps.backendHole(this, goalId, holeContents, backendExpr, payload),
  });

  /** Send Cmd_abort to the running Agda process. */
  async abort(): Promise<AgdaResponse[]> {
    return this.runIndependentCommand("Cmd_abort", 10_000);
  }

  /** Send Cmd_exit to the running Agda process. */
  async exit(): Promise<AgdaResponse[]> {
    this.exiting = true;
    return this.runIndependentCommand("Cmd_exit", 10_000);
  }

  // ── Deprecated flat methods (backward compatibility) ───────────

  /** @deprecated Use session.goal.typeContext() */
  goalTypeContext(id: number) { return this.goal.typeContext(id); }
  /** @deprecated Use session.goal.type() */
  goalType(id: number) { return this.goal.type(id); }
  /** @deprecated Use session.goal.context() */
  context(id: number) { return this.goal.context(id); }
  /** @deprecated Use session.goal.typeContextCheck() */
  goalTypeContextCheck(id: number, expr: string) { return this.goal.typeContextCheck(id, expr); }
  /** @deprecated Use session.goal.caseSplit() */
  caseSplit(id: number, variable: string) { return this.goal.caseSplit(id, variable); }
  /** @deprecated Use session.goal.give() */
  give(id: number, expr: string) { return this.goal.give(id, expr); }
  /** @deprecated Use session.goal.refine() */
  refine(id: number, expr: string) { return this.goal.refine(id, expr); }
  /** @deprecated Use session.goal.refineExact() */
  refineExact(id: number, expr: string) { return this.goal.refineExact(id, expr); }
  /** @deprecated Use session.goal.intro() */
  intro(id: number, expr?: string) { return this.goal.intro(id, expr); }
  /** @deprecated Use session.goal.autoOne() */
  autoOne(id: number) { return this.goal.autoOne(id); }
  /** @deprecated Use session.goal.metas() */
  metas() { return this.goal.metas(); }
  /** @deprecated Use session.expr.compute() */
  compute(id: number, expr: string) { return this.expr.compute(id, expr); }
  /** @deprecated Use session.expr.computeTopLevel() */
  computeTopLevel(expr: string) { return this.expr.computeTopLevel(expr); }
  /** @deprecated Use session.expr.infer() */
  infer(id: number, expr: string) { return this.expr.infer(id, expr); }
  /** @deprecated Use session.expr.inferTopLevel() */
  inferTopLevel(expr: string) { return this.expr.inferTopLevel(expr); }
  /** @deprecated Use session.query.constraints() */
  constraints() { return this.query.constraints(); }
  /** @deprecated Use session.query.solveAll() */
  solveAll() { return this.query.solveAll(); }
  /** @deprecated Use session.query.solveOne() */
  solveOne(goalId: number) { return this.query.solveOne(goalId); }
  /** @deprecated Use session.query.whyInScope() */
  whyInScope(goalId: number, name: string) { return this.query.whyInScope(goalId, name); }
  /** @deprecated Use session.query.whyInScopeTopLevel() */
  whyInScopeTopLevel(name: string) { return this.query.whyInScopeTopLevel(name); }
  /** @deprecated Use session.query.elaborate() */
  elaborate(goalId: number, expr: string) { return this.query.elaborate(goalId, expr); }
  /** @deprecated Use session.query.helperFunction() */
  helperFunction(goalId: number, expr: string) { return this.query.helperFunction(goalId, expr); }
  /** @deprecated Use session.query.showModuleContents() */
  showModuleContents(goalId: number, moduleName: string) { return this.query.showModuleContents(goalId, moduleName); }
  /** @deprecated Use session.query.showModuleContentsTopLevel() */
  showModuleContentsTopLevel(moduleName: string) { return this.query.showModuleContentsTopLevel(moduleName); }
  /** @deprecated Use session.query.searchAbout() */
  searchAbout(q: string) { return this.query.searchAbout(q); }
  /** @deprecated Use session.query.autoAll() */
  autoAll() { return this.query.autoAll(); }
  /** @deprecated Use session.query.showVersion() */
  showVersion() { return this.query.showVersion(); }
  /** @deprecated Use session.query.goalTypeContextInfer() */
  goalTypeContextInfer(goalId: number, expr: string) { return this.query.goalTypeContextInfer(goalId, expr); }
  /** @deprecated Use session.display.loadHighlightingInfo() */
  loadHighlightingInfo(filePath: string) { return this.display.loadHighlightingInfo(filePath); }
  /** @deprecated Use session.display.tokenHighlighting() */
  tokenHighlighting(filePath: string, remove?: boolean) { return this.display.tokenHighlighting(filePath, remove); }
  /** @deprecated Use session.display.highlight() */
  highlight(goalId: number, expr: string) { return this.display.highlight(goalId, expr); }
  /** @deprecated Use session.display.showImplicitArgs() */
  showImplicitArgs(show: boolean) { return this.display.showImplicitArgs(show); }
  /** @deprecated Use session.display.toggleImplicitArgs() */
  toggleImplicitArgs() { return this.display.toggleImplicitArgs(); }
  /** @deprecated Use session.display.showIrrelevantArgs() */
  showIrrelevantArgs(show: boolean) { return this.display.showIrrelevantArgs(show); }
  /** @deprecated Use session.display.toggleIrrelevantArgs() */
  toggleIrrelevantArgs() { return this.display.toggleIrrelevantArgs(); }
  /** @deprecated Use session.backend.compile() */
  compile(backendExpr: string, filePath: string, argv?: string[]) { return this.backend.compile(backendExpr, filePath, argv); }
  /** @deprecated Use session.backend.top() */
  backendTop(backendExpr: string, payload: string) { return this.backend.top(backendExpr, payload); }
  /** @deprecated Use session.backend.hole() */
  backendHole(goalId: number, holeContents: string, backendExpr: string, payload: string) { return this.backend.hole(goalId, holeContents, backendExpr, payload); }

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
    this.currentFile = null;
    this.goalIds = [];
    this.lastLoadedMtime = null;
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = false;
    this.exiting = false;
  }
}
