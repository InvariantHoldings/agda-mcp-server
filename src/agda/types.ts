// MIT License — see LICENSE
//
// Shared type definitions for the Agda interaction layer.

import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";

// ── Session context ───────────────────────────────────────────────────

/**
 * Minimal command-dispatch context for delegate functions.
 * Delegates only need to send commands and read goal state —
 * they never touch the process, buffer, or event emitter.
 */
export interface AgdaCommandContext {
  sendCommand(cmd: string): Promise<AgdaResponse[]>;
  iotcm(agdaCmd: string): string;
  requireFile(): string;
  readonly goalIds: number[];
}

/**
 * Full session context including process internals.
 * Used by the AgdaSession class itself; delegates should
 * prefer AgdaCommandContext.
 */
export interface AgdaSessionContext extends AgdaCommandContext {
  proc: ChildProcess | null;
  repoRoot: string;
  currentFile: string | null;
  buffer: string;
  responseQueue: AgdaResponse[];
  emitter: EventEmitter;
  collecting: boolean;
  ensureProcess(): ChildProcess;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface AgdaResponse {
  kind: string;
  [key: string]: unknown;
}

export interface AgdaGoal {
  goalId: number;
  type: string;
  context: string[];
}

export interface LoadResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  goals: AgdaGoal[];
  allGoalsText: string;
  invisibleGoalCount: number;
  goalCount: number;
  hasHoles: boolean;
  isComplete: boolean;
  classification: string;
  raw: AgdaResponse[];
}

export interface GoalInfo {
  goalId: number;
  type: string;
  context: string[];
  raw: AgdaResponse[];
}

export interface GoalTypeResult {
  goalId: number;
  type: string;
  raw: AgdaResponse[];
}

export interface ContextResult {
  goalId: number;
  context: string[];
  raw: AgdaResponse[];
}

export interface CaseSplitResult {
  clauses: string[];
  raw: AgdaResponse[];
}

export interface GiveResult {
  result: string;
  raw: AgdaResponse[];
}

export interface ComputeResult {
  normalForm: string;
  raw: AgdaResponse[];
}

export interface InferResult {
  type: string;
  raw: AgdaResponse[];
}

export interface AutoResult {
  solution: string;
  raw: AgdaResponse[];
}

export interface SolveResult {
  solutions: string[];
  raw: AgdaResponse[];
}

export interface WhyInScopeResult {
  explanation: string;
  raw: AgdaResponse[];
}

export interface ElaborateResult {
  elaboration: string;
  raw: AgdaResponse[];
}

export interface HelperFunctionResult {
  helperType: string;
  raw: AgdaResponse[];
}

export interface ModuleContentsResult {
  contents: string;
  raw: AgdaResponse[];
}

export interface SearchAboutResult {
  results: string;
  raw: AgdaResponse[];
}

export interface GoalTypeContextInferResult {
  goalType: string;
  context: string[];
  inferredType: string;
  raw: AgdaResponse[];
}

export interface GoalTypeContextCheckResult {
  goalType: string;
  context: string[];
  checkedExpr: string;
  raw: AgdaResponse[];
}

export interface ShowVersionResult {
  version: string;
  raw: AgdaResponse[];
}

export interface DisplayControlResult {
  output: string;
  checked: boolean | null;
  showImplicitArguments: boolean | null;
  showIrrelevantArguments: boolean | null;
  raw: AgdaResponse[];
}

export interface BackendCommandResult {
  success: boolean;
  output: string;
  raw: AgdaResponse[];
}

export interface TypeCheckResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  goals: AgdaGoal[];
  invisibleGoalCount: number;
  goalCount: number;
  hasHoles: boolean;
  isComplete: boolean;
  classification: string;
  raw: AgdaResponse[];
}
