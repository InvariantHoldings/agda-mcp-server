# Extension Modules

This server supports project-specific extension modules loaded at startup.

For runnable sample modules, see:

- [examples/extensions/README.md](../examples/extensions/README.md)

## Loading extensions

Set these environment variables when starting the server:

- AGDA_MCP_ROOT: root directory used for resolving files.
- AGDA_MCP_EXTENSION_MODULES: colon-separated list of extension module specifiers.

Example:

```bash
AGDA_MCP_ROOT=. AGDA_MCP_EXTENSION_MODULES=dist/extensions/custom.js node dist/index.js
```

Module resolution rules:

- Absolute paths are used directly.
- Relative paths are resolved relative to AGDA_MCP_ROOT.
- file:// specifiers are used as-is.
- Other values are treated as normal module specifiers.

## Extension contract

An extension can export:

- register
- any number of functions whose names start with register (for example: registerCore, registerDiagnostics)

Each register function receives:

- server: McpServer
- session: AgdaSession
- repoRoot: string

Type signature:

```ts
type ExtensionRegister = (
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
) => void | Promise<void>;
```

## Example 1: simple status probe tool

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "custom_probe",
    "Return basic extension and session diagnostics.",
    {
      note: z.string().optional(),
    },
    async ({ note }) => {
      const loadedFile = session.getLoadedFile();
      const goalIds = session.getGoalIds();

      const text = [
        `repoRoot=${repoRoot}`,
        `loadedFile=${loadedFile ?? "(none)"}`,
        `goals=${goalIds.length}`,
        `note=${note ?? ""}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  );
}
```

## Example 2: split registration by concern

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function registerCore(server: McpServer, session: AgdaSession): void {
  server.tool(
    "custom_goal_count",
    "Show current goal count.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: String(session.getGoalIds().length) }],
    }),
  );
}

export function registerNavigation(server: McpServer, _session: AgdaSession, repoRoot: string): void {
  server.tool(
    "custom_repo_root",
    "Show repository root used by this server.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: repoRoot }],
    }),
  );
}
```

## Example 3: project command that wraps built-in session APIs

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function registerProofHelpers(server: McpServer, session: AgdaSession): void {
  server.tool(
    "custom_goal_snapshot",
    "Show type and context for all current goals.",
    {
      limit: z.number().int().positive().max(20).optional(),
    },
    async ({ limit }) => {
      const ids = session.getGoalIds().slice(0, limit ?? 10);
      const parts: string[] = [];

      for (const goalId of ids) {
        const info = await session.goalTypeContext(goalId);
        parts.push(`?${goalId}`);
        parts.push(`type: ${info.type || "(unknown)"}`);
        if (info.context.length > 0) {
          parts.push(`context: ${info.context.join("; ")}`);
        }
        parts.push("");
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") || "No goals." }],
      };
    },
  );
}
```

## Example 4: domain-specific policy check

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgdaSession } from "agda-mcp-server";

export function registerPolicies(server: McpServer, _session: AgdaSession, repoRoot: string): void {
  server.tool(
    "custom_require_pragma",
    "Check whether a file contains a required OPTIONS pragma fragment.",
    {
      file: z.string(),
      required: z.string().default("--safe"),
    },
    async ({ file, required }) => {
      const target = resolve(repoRoot, file);
      if (!existsSync(target)) {
        return { content: [{ type: "text" as const, text: `File not found: ${target}` }] };
      }

      const text = readFileSync(target, "utf8");
      const ok = text.includes(required);

      return {
        content: [{
          type: "text" as const,
          text: ok ? `PASS: found ${required}` : `FAIL: missing ${required}`,
        }],
      };
    },
  );
}
```

## Operational tips

- Keep tool names unique across core tools and extension tools.
- Prefer deterministic outputs that are easy to parse.
- If an extension tool mutates files, document that clearly in the tool description.
- For long-running extension operations, return progressive or concise status text.
- Keep extension modules focused by concern (proof helpers, navigation helpers, policy checks).

## Recommended workflow

Use this workflow when adding or evolving extensions in this repository.

1. Start from the examples catalog in `examples/extensions/` and copy the closest sample.
2. Keep extension scope narrow: one concern per module (proof helper, policy check, navigation helper).
3. Prefer stable text outputs and explicit error messages so MCP clients can reason about results.
4. Add or update tests under `test/examples/` and any relevant integration tests under `test/integration/`.
5. Verify locally:
  - `npm run build`
  - `npm test`
  - Optional live checks: `RUN_AGDA_INTEGRATION=1 npm run test:integration`
6. Update docs links:
  - `docs/extensions.md` for contract and workflow
  - `examples/extensions/README.md` for runnable snippets
  - `README.md` extension section for discoverability
7. If an extension pattern becomes generally useful, promote it into core tools with tests and changelog updates.
