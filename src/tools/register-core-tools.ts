// MIT License — see LICENSE
//
// Shared core-tool composition for runtime and tests.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AgdaSession } from "../agda-process.js";
import { register as registerSession } from "./session.js";
import { register as registerGoalTools } from "./goal-tools.js";
import { register as registerExpressionTools } from "./expression-tools.js";
import { register as registerQueryTools } from "./query-tools.js";
import { register as registerFileTools } from "./file-tools.js";
import { register as registerScopeTools } from "./scope-tools.js";
import { register as registerDisplay } from "./display.js";
import { register as registerBackend } from "./backend.js";
import { register as registerAnalysis } from "./analysis-tools.js";
import { register as registerReporting } from "./reporting-tools.js";
import { register as registerCacheTools } from "./cache-tools.js";
import { register as registerImpactTool } from "./impact-tool.js";
import { register as registerAgentUxTools } from "./agent-ux-tools.js";

export function registerCoreTools(
  server: McpServer,
  session: AgdaSession,
  projectRoot: string,
): void {
  registerSession(server, session, projectRoot);
  registerGoalTools(server, session, projectRoot);
  registerExpressionTools(server, session, projectRoot);
  registerQueryTools(server, session, projectRoot);
  registerFileTools(server, session, projectRoot);
  registerScopeTools(server, session, projectRoot);
  registerDisplay(server, session, projectRoot);
  registerBackend(server, session, projectRoot);
  registerAnalysis(server, session, projectRoot);
  registerReporting(server, session, projectRoot);
  registerCacheTools(server, session, projectRoot);
  registerImpactTool(server, session, projectRoot);
  registerAgentUxTools(server, session, projectRoot);
}
