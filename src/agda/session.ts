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

import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import type {
  AgdaResponse,
  AgdaGoal,
  LoadResult,
  GoalInfo,
  CaseSplitResult,
  GiveResult,
  ComputeResult,
  InferResult,
  AutoResult,
  WhyInScopeResult,
  ElaborateResult,
  HelperFunctionResult,
  ModuleContentsResult,
  SearchAboutResult,
  GoalTypeContextInferResult,
} from "./types.js";
import { extractMessage } from "./response-parsing.js";

// Delegate modules
import * as GoalOps from "./goal-operations.js";
import * as ExprOps from "./expression-operations.js";
import * as AdvancedOps from "./advanced-queries.js";

// ── Binary discovery ──────────────────────────────────────────────────

/**
 * Find the repo-pinned Agda binary.
 */
export function findAgdaBinary(repoRoot: string): string {
  if (process.env.AGDA_BIN) return process.env.AGDA_BIN;
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
        const resp: AgdaResponse = JSON.parse(trimmed);
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

    const cmd = this.iotcm(
      `Cmd_load "${absPath}" []`,
    );
    const responses = await this.sendCommand(cmd);

    const errors: string[] = [];
    const warnings: string[] = [];
    const goals: AgdaGoal[] = [];
    let allGoalsText = "";
    let success = true;

    for (const resp of responses) {
      // Extract interaction points (goal IDs)
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

      // Extract errors from DisplayInfo
      if (resp.kind === "DisplayInfo") {
        const info = resp.info as Record<string, unknown> | undefined;
        if (info) {
          if (info.kind === "Error") {
            success = false;
            const msg = extractMessage(info);
            errors.push(msg);
          }
          if (info.kind === "AllGoalsWarnings") {
            allGoalsText = extractMessage(info);
            // Parse warnings from the all-goals text
            const warnMatch = allGoalsText.match(/———— Warnings? ————[\s\S]*$/);
            if (warnMatch) {
              warnings.push(warnMatch[0]);
            }
          }
        }
      }

      // Stderr errors
      if (resp.kind === "StderrOutput") {
        const text = String(resp.text ?? "").trim();
        if (text && (text.includes("Error") || text.includes("error"))) {
          errors.push(text);
          success = false;
        }
      }
    }

    return { success, errors, warnings, goals, allGoalsText, raw: responses };
  }

  // ── Goal operations (delegated) ───────────────────────────────────

  async goalTypeContext(goalId: number): Promise<GoalInfo> {
    return GoalOps.goalTypeContext(this, goalId);
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

  async solveAll(): Promise<{ solutions: string[]; raw: AgdaResponse[] }> {
    return AdvancedOps.solveAll(this);
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

  async goalTypeContextInfer(goalId: number, expr: string): Promise<GoalTypeContextInferResult> {
    return AdvancedOps.goalTypeContextInfer(this, goalId, expr);
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
  }
}
