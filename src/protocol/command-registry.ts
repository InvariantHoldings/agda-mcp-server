export type CommandCategory =
  | "session"
  | "proof"
  | "navigation"
  | "process"
  | "highlighting"
  | "backend";

export type CommandExposure = "mcp" | "internal" | "planned";

export interface ProtocolCommandDefinition {
  agdaCommand: string;
  category: CommandCategory;
  exposure: CommandExposure;
  mcpTool?: string;
  implemented: boolean;
  notes?: string;
}

export const upstreamParityVerification = {
  source: "https://github.com/agda/agda/blob/main/src/full/Agda/Interaction/Base.hs",
  verifiedAt: "2026-03-24",
} as const;

export const upstreamAgdaCommands = [
  "Cmd_load",
  "Cmd_constraints",
  "Cmd_metas",
  "Cmd_load_no_metas",
  "Cmd_show_module_contents_toplevel",
  "Cmd_search_about_toplevel",
  "Cmd_solveAll",
  "Cmd_solveOne",
  "Cmd_autoOne",
  "Cmd_autoAll",
  "Cmd_infer_toplevel",
  "Cmd_compute_toplevel",
  "Cmd_compile",
  "Cmd_backend_top",
  "Cmd_backend_hole",
  "Cmd_load_highlighting_info",
  "Cmd_tokenHighlighting",
  "Cmd_highlight",
  "ShowImplicitArgs",
  "ToggleImplicitArgs",
  "ShowIrrelevantArgs",
  "ToggleIrrelevantArgs",
  "Cmd_give",
  "Cmd_refine",
  "Cmd_intro",
  "Cmd_refine_or_intro",
  "Cmd_context",
  "Cmd_helper_function",
  "Cmd_infer",
  "Cmd_goal_type",
  "Cmd_elaborate_give",
  "Cmd_goal_type_context",
  "Cmd_goal_type_context_infer",
  "Cmd_goal_type_context_check",
  "Cmd_show_module_contents",
  "Cmd_make_case",
  "Cmd_compute",
  "Cmd_why_in_scope",
  "Cmd_why_in_scope_toplevel",
  "Cmd_show_version",
  "Cmd_abort",
  "Cmd_exit",
] as const;

export const protocolCommandRegistry: ProtocolCommandDefinition[] = [
  { agdaCommand: "Cmd_load", category: "session", exposure: "mcp", mcpTool: "agda_load", implemented: true },
  { agdaCommand: "Cmd_constraints", category: "proof", exposure: "mcp", mcpTool: "agda_constraints", implemented: true },
  { agdaCommand: "Cmd_metas", category: "proof", exposure: "mcp", mcpTool: "agda_metas", implemented: true },
  { agdaCommand: "Cmd_load_no_metas", category: "session", exposure: "mcp", mcpTool: "agda_load_no_metas", implemented: true },
  { agdaCommand: "Cmd_show_module_contents_toplevel", category: "navigation", exposure: "mcp", mcpTool: "agda_show_module", implemented: true },
  { agdaCommand: "Cmd_search_about_toplevel", category: "navigation", exposure: "mcp", mcpTool: "agda_search_about", implemented: true },
  { agdaCommand: "Cmd_solveAll", category: "proof", exposure: "mcp", mcpTool: "agda_solve_all", implemented: true },
  { agdaCommand: "Cmd_solveOne", category: "proof", exposure: "mcp", mcpTool: "agda_solve_one", implemented: true },
  { agdaCommand: "Cmd_autoOne", category: "proof", exposure: "mcp", mcpTool: "agda_auto", implemented: true },
  { agdaCommand: "Cmd_autoAll", category: "proof", exposure: "mcp", mcpTool: "agda_auto_all", implemented: true },
  { agdaCommand: "Cmd_infer_toplevel", category: "proof", exposure: "mcp", mcpTool: "agda_infer", implemented: true },
  { agdaCommand: "Cmd_compute_toplevel", category: "proof", exposure: "mcp", mcpTool: "agda_compute", implemented: true },
  { agdaCommand: "Cmd_compile", category: "backend", exposure: "mcp", mcpTool: "agda_compile", implemented: true },
  { agdaCommand: "Cmd_backend_top", category: "backend", exposure: "mcp", mcpTool: "agda_backend_top", implemented: true },
  { agdaCommand: "Cmd_backend_hole", category: "backend", exposure: "mcp", mcpTool: "agda_backend_hole", implemented: true },
  { agdaCommand: "Cmd_load_highlighting_info", category: "highlighting", exposure: "mcp", mcpTool: "agda_load_highlighting_info", implemented: true },
  { agdaCommand: "Cmd_tokenHighlighting", category: "highlighting", exposure: "mcp", mcpTool: "agda_token_highlighting", implemented: true },
  { agdaCommand: "Cmd_highlight", category: "highlighting", exposure: "mcp", mcpTool: "agda_highlight", implemented: true },
  { agdaCommand: "ShowImplicitArgs", category: "process", exposure: "mcp", mcpTool: "agda_show_implicit_args", implemented: true },
  { agdaCommand: "ToggleImplicitArgs", category: "process", exposure: "mcp", mcpTool: "agda_toggle_implicit_args", implemented: true },
  { agdaCommand: "ShowIrrelevantArgs", category: "process", exposure: "mcp", mcpTool: "agda_show_irrelevant_args", implemented: true },
  { agdaCommand: "ToggleIrrelevantArgs", category: "process", exposure: "mcp", mcpTool: "agda_toggle_irrelevant_args", implemented: true },
  { agdaCommand: "Cmd_give", category: "proof", exposure: "mcp", mcpTool: "agda_give", implemented: true },
  { agdaCommand: "Cmd_refine", category: "proof", exposure: "mcp", mcpTool: "agda_refine_exact", implemented: true },
  { agdaCommand: "Cmd_intro", category: "proof", exposure: "mcp", mcpTool: "agda_intro", implemented: true },
  { agdaCommand: "Cmd_refine_or_intro", category: "proof", exposure: "mcp", mcpTool: "agda_refine", implemented: true, notes: "Current MCP refine uses Agda's combined refine-or-intro command." },
  { agdaCommand: "Cmd_context", category: "proof", exposure: "mcp", mcpTool: "agda_context", implemented: true },
  { agdaCommand: "Cmd_helper_function", category: "proof", exposure: "mcp", mcpTool: "agda_helper_function", implemented: true },
  { agdaCommand: "Cmd_infer", category: "proof", exposure: "mcp", mcpTool: "agda_infer", implemented: true },
  { agdaCommand: "Cmd_goal_type", category: "proof", exposure: "mcp", mcpTool: "agda_goal", implemented: true },
  { agdaCommand: "Cmd_elaborate_give", category: "proof", exposure: "mcp", mcpTool: "agda_elaborate", implemented: true },
  { agdaCommand: "Cmd_goal_type_context", category: "proof", exposure: "mcp", mcpTool: "agda_goal_type", implemented: true, notes: "Current MCP goal type tool uses goal-type-context output." },
  { agdaCommand: "Cmd_goal_type_context_infer", category: "proof", exposure: "mcp", mcpTool: "agda_goal_type_context_infer", implemented: true },
  { agdaCommand: "Cmd_goal_type_context_check", category: "proof", exposure: "mcp", mcpTool: "agda_goal_type_context_check", implemented: true },
  { agdaCommand: "Cmd_show_module_contents", category: "navigation", exposure: "mcp", mcpTool: "agda_show_module", implemented: true },
  { agdaCommand: "Cmd_make_case", category: "proof", exposure: "mcp", mcpTool: "agda_case_split", implemented: true },
  { agdaCommand: "Cmd_compute", category: "proof", exposure: "mcp", mcpTool: "agda_compute", implemented: true },
  { agdaCommand: "Cmd_why_in_scope", category: "navigation", exposure: "mcp", mcpTool: "agda_why_in_scope", implemented: true },
  { agdaCommand: "Cmd_why_in_scope_toplevel", category: "navigation", exposure: "mcp", mcpTool: "agda_why_in_scope", implemented: true },
  { agdaCommand: "Cmd_show_version", category: "process", exposure: "mcp", mcpTool: "agda_show_version", implemented: true },
  { agdaCommand: "Cmd_abort", category: "process", exposure: "mcp", mcpTool: "agda_abort", implemented: true },
  { agdaCommand: "Cmd_exit", category: "process", exposure: "mcp", mcpTool: "agda_exit", implemented: true },
] as const;

export function getImplementedProtocolCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => command.implemented);
}

export function getMcpExposedCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => command.exposure === "mcp");
}

export function getPlannedProtocolCommands(): ProtocolCommandDefinition[] {
  return protocolCommandRegistry.filter((command) => !command.implemented);
}
