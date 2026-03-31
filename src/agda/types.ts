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
  syncGoalIdsFromResponses(responses: AgdaResponse[]): void;
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
}

export interface GoalInfo {
  goalId: number;
  type: string;
  context: string[];
}

export interface GoalTypeResult {
  goalId: number;
  type: string;
}

export interface ContextResult {
  goalId: number;
  context: string[];
}

export interface CaseSplitResult {
  clauses: string[];
}

export interface GiveResult {
  result: string;
}

export interface ComputeResult {
  normalForm: string;
}

export interface InferResult {
  type: string;
}

export interface AutoResult {
  solution: string;
}

export interface SolveResult {
  solutions: string[];
}

export interface WhyInScopeResult {
  explanation: string;
}

export interface ElaborateResult {
  elaboration: string;
}

export interface HelperFunctionResult {
  helperType: string;
}

export interface ModuleContentsResult {
  contents: string;
}

export interface SearchAboutResult {
  query: string;
  results: Array<{
    name: string;
    term: string;
  }>;
  text: string;
}

export interface GoalTypeContextInferResult {
  goalType: string;
  context: string[];
  inferredType: string;
}

export interface GoalTypeContextCheckResult {
  goalType: string;
  context: string[];
  checkedExpr: string;
}

export interface ShowVersionResult {
  version: string;
}

export interface DisplayControlResult {
  output: string;
  checked: boolean | null;
  showImplicitArguments: boolean | null;
  showIrrelevantArguments: boolean | null;
}

export interface BackendCommandResult {
  success: boolean;
  output: string;
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
}
