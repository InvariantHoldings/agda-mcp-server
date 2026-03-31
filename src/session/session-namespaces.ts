import type { AgdaCommandContext } from "../agda/types.js";
import * as GoalOps from "../agda/goal-operations.js";
import * as ExprOps from "../agda/expression-operations.js";
import * as AdvancedOps from "../agda/advanced-queries.js";
import * as DisplayOps from "../agda/display-operations.js";
import * as BackendOps from "../agda/backend-operations.js";

export function createSessionNamespaces(ctx: AgdaCommandContext) {
  return {
    goal: Object.freeze({
      typeContext: (id: number) => GoalOps.goalTypeContext(ctx, id),
      type: (id: number) => GoalOps.goalType(ctx, id),
      context: (id: number) => GoalOps.context(ctx, id),
      typeContextCheck: (id: number, expr: string) => GoalOps.goalTypeContextCheck(ctx, id, expr),
      caseSplit: (id: number, variable: string) => GoalOps.caseSplit(ctx, id, variable),
      give: (id: number, expr: string) => GoalOps.give(ctx, id, expr),
      refine: (id: number, expr: string) => GoalOps.refine(ctx, id, expr),
      refineExact: (id: number, expr: string) => GoalOps.refineExact(ctx, id, expr),
      intro: (id: number, expr?: string) => GoalOps.intro(ctx, id, expr),
      autoOne: (id: number) => GoalOps.autoOne(ctx, id),
      metas: () => GoalOps.metas(ctx),
    }),
    expr: Object.freeze({
      compute: (id: number, expr: string) => ExprOps.compute(ctx, id, expr),
      computeTopLevel: (expr: string) => ExprOps.computeTopLevel(ctx, expr),
      infer: (id: number, expr: string) => ExprOps.infer(ctx, id, expr),
      inferTopLevel: (expr: string) => ExprOps.inferTopLevel(ctx, expr),
    }),
    query: Object.freeze({
      constraints: () => AdvancedOps.constraints(ctx),
      solveAll: () => AdvancedOps.solveAll(ctx),
      solveOne: (goalId: number) => AdvancedOps.solveOne(ctx, goalId),
      whyInScope: (goalId: number, name: string) => AdvancedOps.whyInScope(ctx, goalId, name),
      whyInScopeTopLevel: (name: string) => AdvancedOps.whyInScopeTopLevel(ctx, name),
      elaborate: (goalId: number, expr: string) => AdvancedOps.elaborate(ctx, goalId, expr),
      helperFunction: (goalId: number, expr: string) => AdvancedOps.helperFunction(ctx, goalId, expr),
      showModuleContents: (goalId: number, moduleName: string) => AdvancedOps.showModuleContents(ctx, goalId, moduleName),
      showModuleContentsTopLevel: (moduleName: string) => AdvancedOps.showModuleContentsTopLevel(ctx, moduleName),
      searchAbout: (query: string) => AdvancedOps.searchAbout(ctx, query),
      autoAll: () => AdvancedOps.autoAll(ctx),
      showVersion: () => AdvancedOps.showVersion(ctx),
      goalTypeContextInfer: (goalId: number, expr: string) => AdvancedOps.goalTypeContextInfer(ctx, goalId, expr),
    }),
    display: Object.freeze({
      loadHighlightingInfo: (filePath: string) => DisplayOps.loadHighlightingInfo(ctx, filePath),
      tokenHighlighting: (filePath: string, remove?: boolean) => DisplayOps.tokenHighlighting(ctx, filePath, remove),
      highlight: (goalId: number, expr: string) => DisplayOps.highlight(ctx, goalId, expr),
      showImplicitArgs: (show: boolean) => DisplayOps.showImplicitArgs(ctx, show),
      toggleImplicitArgs: () => DisplayOps.toggleImplicitArgs(ctx),
      showIrrelevantArgs: (show: boolean) => DisplayOps.showIrrelevantArgs(ctx, show),
      toggleIrrelevantArgs: () => DisplayOps.toggleIrrelevantArgs(ctx),
    }),
    backend: Object.freeze({
      compile: (backendExpr: string, filePath: string, argv?: string[]) => BackendOps.compile(ctx, backendExpr, filePath, argv ?? []),
      top: (backendExpr: string, payload: string) => BackendOps.backendTop(ctx, backendExpr, payload),
      hole: (goalId: number, holeContents: string, backendExpr: string, payload: string) => BackendOps.backendHole(ctx, goalId, holeContents, backendExpr, payload),
    }),
  };
}
