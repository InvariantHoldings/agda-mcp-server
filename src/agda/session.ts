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
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { deriveSessionPhase, type SessionPhase } from "../session/session-state.js";
import type {
  AgdaResponse,
  AgdaGoal,
  LoadResult,
  GoalInfo,
  GoalTypeResult,
  ContextResult,
  CaseSplitResult,
  GiveResult,
  ComputeResult,
  InferResult,
  AutoResult,
  SolveResult,
  WhyInScopeResult,
  ElaborateResult,
  HelperFunctionResult,
  ModuleContentsResult,
  SearchAboutResult,
  GoalTypeContextInferResult,
  GoalTypeContextCheckResult,
  ShowVersionResult,
  DisplayControlResult,
  BackendCommandResult,
} from "./types.js";
import { extractMessage, coerceString } from "./response-parsing.js";
import { normalizeAgdaResponse } from "./normalize-response.js";

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

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  /** Start the Agda process if not already running. */
  ensureProcess(): ChildProcess {
    if (this.proc && this.proc.exitCode === null) {
      return this.proc;
    }

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

  /** Parse newline-delimited JSON from the stdout buffer. */
  private drainBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Agda may emit non-JSON preamble lines (e.g. "Agda2>")
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;

      try {
        const resp: AgdaResponse = normalizeAgdaResponse(JSON.parse(trimmed));
        if (this.collecting) {
          this.responseQueue.push(resp);
        }

        // A Status response with checked=true signals command completion
        if (resp.kind === "Status") {
          this.emitter.emit("done");
        }
        // ClearHighlighting/ClearRunningInfo can also signal end of response
        if (resp.kind === "ClearRunningInfo") {
          // Give a small delay for any trailing responses, then signal
          setTimeout(() => this.emitter.emit("done"), 100);
        }
      } catch {
        // Non-JSON line — skip
      }
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

    this.responseQueue = [];
    this.collecting = true;

    return new Promise<AgdaResponse[]>((resolveCmd, rejectCmd) => {
      const timeout = setTimeout(() => {
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
          resolveCmd([...this.responseQueue]);
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

  private parseLoadResponses(responses: AgdaResponse[]): Omit<LoadResult, "raw"> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const goals: AgdaGoal[] = [];
    let allGoalsText = "";
    let success = true;

    for (const resp of responses) {
      if (resp.kind === "InteractionPoints") {
        const points = resp.interactionPoints;
        if (Array.isArray(points)) {
          for (const pt of points) {
            const id = typeof pt === "number" ? pt : (pt as { id: number }).id;
            this.goalIds.push(id);
            goals.push({ goalId: id, type: "?", context: [] });
          }
        }
      }

      if (resp.kind === "DisplayInfo") {
        const info = resp.info as Record<string, unknown> | undefined;
        if (info) {
          if (info.kind === "Error") {
            success = false;
            errors.push(extractMessage(info));
          }
          if (info.kind === "AllGoalsWarnings") {
            allGoalsText = extractMessage(info);
            const warnMatch = allGoalsText.match(/———— Warnings? ————[\s\S]*$/);
            if (warnMatch) {
              warnings.push(warnMatch[0]);
            }
            // --interaction-json sends errors as an array in AllGoalsWarnings
            const infoErrors = info.errors;
            if (Array.isArray(infoErrors) && infoErrors.length > 0) {
              success = false;
              for (const e of infoErrors) {
                const msg = typeof e === "string" ? e : (typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).type === "string" ? (e as Record<string, unknown>).type as string : JSON.stringify(e));
                errors.push(msg);
              }
            }
            // Cross-check: if visibleGoals has entries not yet in goals, add them
            const visGoals = info.visibleGoals;
            if (Array.isArray(visGoals)) {
              const existingIds = new Set(goals.map(g => g.goalId));
              for (const vg of visGoals) {
                const obj = vg as Record<string, unknown>;
                const id = typeof obj.constraintObj === "number" ? obj.constraintObj : undefined;
                if (id !== undefined && !existingIds.has(id)) {
                  goals.push({ goalId: id, type: typeof obj.type === "string" ? obj.type : "?", context: [] });
                }
              }
            }
          }
        }
      }

      if (resp.kind === "StderrOutput") {
        const text = coerceString(resp.text).trim();
        if (text && (text.includes("Error") || text.includes("error"))) {
          errors.push(text);
          success = false;
        }
      }
    }

    return { success, errors, warnings, goals, allGoalsText };
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Load (type-check) a file. This is always the first command — it
   * establishes the interaction state and assigns goal IDs.
   */
  async load(filePath: string): Promise<LoadResult> {
    const absPath = resolve(this.repoRoot, filePath);
    if (!existsSync(absPath)) {
      return {
        success: false,
        errors: [`File not found: ${absPath}`],
        warnings: [],
        goals: [],
        allGoalsText: "",
        raw: [],
      };
    }

    this.currentFile = absPath;
    this.goalIds = [];

    const cmd = this.iotcm(`Cmd_load "${absPath}" []`);
    const responses = await this.sendCommand(cmd);
    return { ...this.parseLoadResponses(responses), raw: responses };
  }

  async loadNoMetas(filePath: string): Promise<LoadResult> {
    const absPath = resolve(this.repoRoot, filePath);
    if (!existsSync(absPath)) {
      return {
        success: false,
        errors: [`File not found: ${absPath}`],
        warnings: [],
        goals: [],
        allGoalsText: "",
        raw: [],
      };
    }

    this.currentFile = absPath;
    this.goalIds = [];

    const responses = await this.sendCommand(
      this.buildIotcm(absPath, `Cmd_load_no_metas "${absPath}"`),
    );

    return { ...this.parseLoadResponses(responses), raw: responses };
  }

  // ── Goal operations (delegated) ───────────────────────────────────

  async goalTypeContext(goalId: number): Promise<GoalInfo> {
    return GoalOps.goalTypeContext(this, goalId);
  }

  async goalType(goalId: number): Promise<GoalTypeResult> {
    return GoalOps.goalType(this, goalId);
  }

  async context(goalId: number): Promise<ContextResult> {
    return GoalOps.context(this, goalId);
  }

  async goalTypeContextCheck(goalId: number, expr: string): Promise<GoalTypeContextCheckResult> {
    return GoalOps.goalTypeContextCheck(this, goalId, expr);
  }

  async caseSplit(goalId: number, variable: string): Promise<CaseSplitResult> {
    return GoalOps.caseSplit(this, goalId, variable);
  }

  async give(goalId: number, expr: string): Promise<GiveResult> {
    return GoalOps.give(this, goalId, expr);
  }

  async refine(goalId: number, expr: string): Promise<GiveResult> {
    return GoalOps.refine(this, goalId, expr);
  }

  async refineExact(goalId: number, expr: string): Promise<GiveResult> {
    return GoalOps.refineExact(this, goalId, expr);
  }

  async intro(goalId: number, expr = ""): Promise<GiveResult> {
    return GoalOps.intro(this, goalId, expr);
  }

  async autoOne(goalId: number): Promise<AutoResult> {
    return GoalOps.autoOne(this, goalId);
  }

  async metas(): Promise<{ goals: AgdaGoal[]; text: string; raw: AgdaResponse[] }> {
    return GoalOps.metas(this);
  }

  // ── Expression operations (delegated) ─────────────────────────────

  async compute(goalId: number, expr: string): Promise<ComputeResult> {
    return ExprOps.compute(this, goalId, expr);
  }

  async computeTopLevel(expr: string): Promise<ComputeResult> {
    return ExprOps.computeTopLevel(this, expr);
  }

  async infer(goalId: number, expr: string): Promise<InferResult> {
    return ExprOps.infer(this, goalId, expr);
  }

  async inferTopLevel(expr: string): Promise<InferResult> {
    return ExprOps.inferTopLevel(this, expr);
  }

  // ── Advanced queries (delegated) ──────────────────────────────────

  async constraints(): Promise<{ text: string; raw: AgdaResponse[] }> {
    return AdvancedOps.constraints(this);
  }

  async solveAll(): Promise<SolveResult> {
    return AdvancedOps.solveAll(this);
  }

  async solveOne(goalId: number): Promise<SolveResult> {
    return AdvancedOps.solveOne(this, goalId);
  }

  async abort(): Promise<AgdaResponse[]> {
    return this.runIndependentCommand("Cmd_abort", 10_000);
  }

  async exit(): Promise<AgdaResponse[]> {
    this.exiting = true;
    return this.runIndependentCommand("Cmd_exit", 10_000);
  }

  async whyInScope(goalId: number, name: string): Promise<WhyInScopeResult> {
    return AdvancedOps.whyInScope(this, goalId, name);
  }

  async whyInScopeTopLevel(name: string): Promise<WhyInScopeResult> {
    return AdvancedOps.whyInScopeTopLevel(this, name);
  }

  async elaborate(goalId: number, expr: string): Promise<ElaborateResult> {
    return AdvancedOps.elaborate(this, goalId, expr);
  }

  async helperFunction(goalId: number, expr: string): Promise<HelperFunctionResult> {
    return AdvancedOps.helperFunction(this, goalId, expr);
  }

  async showModuleContents(goalId: number, moduleName: string): Promise<ModuleContentsResult> {
    return AdvancedOps.showModuleContents(this, goalId, moduleName);
  }

  async showModuleContentsTopLevel(moduleName: string): Promise<ModuleContentsResult> {
    return AdvancedOps.showModuleContentsTopLevel(this, moduleName);
  }

  async searchAbout(query: string): Promise<SearchAboutResult> {
    return AdvancedOps.searchAbout(this, query);
  }

  async autoAll(): Promise<AutoResult> {
    return AdvancedOps.autoAll(this);
  }

  async showVersion(): Promise<ShowVersionResult> {
    return AdvancedOps.showVersion(this);
  }

  async goalTypeContextInfer(goalId: number, expr: string): Promise<GoalTypeContextInferResult> {
    return AdvancedOps.goalTypeContextInfer(this, goalId, expr);
  }

  async loadHighlightingInfo(filePath: string): Promise<DisplayControlResult> {
    return DisplayOps.loadHighlightingInfo(this, filePath);
  }

  async tokenHighlighting(filePath: string, remove = false): Promise<DisplayControlResult> {
    return DisplayOps.tokenHighlighting(this, filePath, remove);
  }

  async highlight(goalId: number, expr: string): Promise<DisplayControlResult> {
    return DisplayOps.highlight(this, goalId, expr);
  }

  async showImplicitArgs(show: boolean): Promise<DisplayControlResult> {
    return DisplayOps.showImplicitArgs(this, show);
  }

  async toggleImplicitArgs(): Promise<DisplayControlResult> {
    return DisplayOps.toggleImplicitArgs(this);
  }

  async showIrrelevantArgs(show: boolean): Promise<DisplayControlResult> {
    return DisplayOps.showIrrelevantArgs(this, show);
  }

  async toggleIrrelevantArgs(): Promise<DisplayControlResult> {
    return DisplayOps.toggleIrrelevantArgs(this);
  }

  async compile(backendExpr: string, filePath: string, argv: string[] = []): Promise<BackendCommandResult> {
    return BackendOps.compile(this, backendExpr, filePath, argv);
  }

  async backendTop(backendExpr: string, payload: string): Promise<BackendCommandResult> {
    return BackendOps.backendTop(this, backendExpr, payload);
  }

  async backendHole(
    goalId: number,
    holeContents: string,
    backendExpr: string,
    payload: string,
  ): Promise<BackendCommandResult> {
    return BackendOps.backendHole(this, goalId, holeContents, backendExpr, payload);
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
    this.currentFile = null;
    this.goalIds = [];
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = false;
    this.exiting = false;
  }
}
