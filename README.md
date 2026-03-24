# agda-mcp-server

[![npm version](https://img.shields.io/npm/v/agda-mcp-server)](https://www.npmjs.com/package/agda-mcp-server)
[![CI](https://github.com/LionOfJewdah/agda-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/LionOfJewdah/agda-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)

`agda-mcp-server` is a stateful [Model Context Protocol](https://modelcontextprotocol.io)
server for interactive [Agda](https://agda.readthedocs.io/) proof development.

It keeps a long-running Agda process alive in `--interaction-json` mode so MCP
clients can use Agda the way a human does in an editor: load a file, inspect
goals, split on variables, refine holes, infer types, normalize expressions,
search the local environment, and iterate on proofs without restarting Agda for
every request.

## What this server provides

- Persistent interactive Agda sessions.
- Goal-aware proof actions over MCP.
- Stateless batch type-checking when you only want a quick validation pass.
- Navigation and scope-inspection helpers for large Agda codebases.
- A small extension system for project-specific or domain-specific tools.

## How it works

The server launches Agda in `--interaction-json` mode and communicates through
Agda's IOTCM protocol over standard input and output.

In practice, the workflow is:

1. Load an Agda file with `agda_load`.
2. Agda assigns interaction point IDs to all open goals.
3. Use those goal IDs with proof-oriented tools such as `agda_goal_type`,
   `agda_case_split`, `agda_refine`, or `agda_give`.
4. Reload the file after applying source edits so Agda can refresh its goals.

This statefulness is the main difference between `agda_load` and the stateless
`agda_typecheck` command.

## Requirements

Before using the server, make sure you have:

- Node.js `>= 24`
- An Agda installation available as `agda` on your `PATH`, or
- A repo-local pinned runner at `tooling/scripts/run-pinned-agda.sh`

If both are available, the pinned runner is preferred.

## Installation

### From source

```bash
npm install
npm run build
```

This produces the distributable server in `dist/`.

### Local CLI entry point

After building, the executable entry point is:

```bash
node dist/index.js
```

The published package also exposes the `agda-mcp-server` binary through the
`bin` field in `package.json`.

## Quick start

Start the server on stdio with a project root:

```bash
AGDA_MCP_ROOT=/path/to/agda/project node dist/index.js
```

If `AGDA_MCP_ROOT` is omitted, the current working directory is used.

## Examples

### Example: load a file and inspect goals

```text
1. agda_load file="Nat/Properties.agda"
  → reports load status and goal IDs

2. agda_session_status
  → shows the loaded file and active goals

3. agda_goal_type goalId=0
  → returns the local context and expected type for `?0`
```

### Example: refine a proof hole

```text
1. agda_goal_type goalId=0
  → inspect the goal before editing

2. agda_refine goalId=0 expr="suc"
  → apply a constructor or function

3. agda_metas
  → inspect any new subgoals created by the refinement
```

### Example: check an expression before committing to it

```text
1. agda_elaborate goalId=0 expr="map f xs"
  → see Agda's elaborated form

2. agda_infer goalId=0 expr="map f xs"
  → confirm the inferred type

3. agda_give goalId=0 expr="map f xs"
  → fill the goal once the expression looks correct
```

### Example: stateless validation in CI or editor automation

```text
agda_typecheck file="MyModule.agda"
```

Use this when you want errors and warnings without creating a persistent session.

## MCP client configuration

### Claude Code

Add a server entry similar to this in your Claude Code settings:

```json
{
  "mcpServers": {
    "agda": {
      "command": "node",
      "args": ["mcp/agda-mcp-server/dist/index.js"],
      "env": {
        "AGDA_MCP_ROOT": "."
      }
    }
  }
}
```

### Other MCP clients

Any MCP client that can spawn a stdio server can run this package. Use the same
pattern:

- command: `node`
- args: path to `dist/index.js`
- environment: set `AGDA_MCP_ROOT` to the Agda project root

## Session model

This server is intentionally stateful.

- One shared Agda session is kept alive.
- The session tracks the currently loaded file.
- Goal IDs are meaningful only for the currently loaded file and current Agda state.
- If the file changes on disk, reload it with `agda_load` before continuing.

If you only want a quick compile check and do not need goals, use
`agda_typecheck` instead of creating a session.

## Tool reference

## Protocol coverage

This repository now tracks full parity with Agda's interactive IOTCM command
constructors listed in `Agda.Interaction.Base` (verification date: 2026-03-24).

- The current protocol inventory lives in `src/protocol/command-registry.ts`.
- That inventory and tests enforce that all tracked upstream commands are
  implemented and MCP-exposed.
- Architecture still keeps a clean separation between transport, protocol
  decoding, and MCP presentation layers.

At the current milestone, the server now exposes:

- `agda_goal_type_context_infer` for goal, context, and inferred-type queries
- `agda_goal_type_context_check` for goal, context, and checked-term queries
- `agda_goal` for exact goal-only display
- `agda_context` for exact context-only display
- `agda_refine_exact` for exact `Cmd_refine`
- `agda_intro` for exact `Cmd_intro`
- `agda_solve_one` for exact `Cmd_solveOne`
- `agda_load_no_metas` for strict loading without unresolved goals
- `agda_abort` and `agda_exit` for process control
- `agda_show_version` for the running Agda process version
- `agda_load_highlighting_info`, `agda_token_highlighting`, and `agda_highlight` for highlighting control
- `agda_show_implicit_args` / `agda_toggle_implicit_args` and `agda_show_irrelevant_args` / `agda_toggle_irrelevant_args` for display toggles
- `agda_compile`, `agda_backend_top`, and `agda_backend_hole` for backend interaction commands

### Session management

| Tool                  | Description                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `agda_load`           | Load and type-check a file, establish the active interactive session, and return current goal IDs |
| `agda_load_no_metas`  | Load and type-check a file, failing if any unsolved metavariables remain                          |
| `agda_session_status` | Show the currently loaded file and available goal IDs                                             |
| `agda_show_version`   | Show the version string reported by the running Agda process                                      |
| `agda_abort`          | Send Agda's `Cmd_abort` to the running process                                                    |
| `agda_exit`           | Send Agda's `Cmd_exit` to the running process                                                     |
| `agda_typecheck`      | Run a stateless batch type-check without creating or updating the interactive session             |

### Display and highlighting

| Tool                          | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `agda_load_highlighting_info` | Load highlighting metadata for a file               |
| `agda_token_highlighting`     | Keep or remove token highlighting output for a file |
| `agda_highlight`              | Highlight an expression in a goal context           |
| `agda_show_implicit_args`     | Set implicit-argument visibility                    |
| `agda_toggle_implicit_args`   | Toggle implicit-argument visibility                 |
| `agda_show_irrelevant_args`   | Set irrelevant-argument visibility                  |
| `agda_toggle_irrelevant_args` | Toggle irrelevant-argument visibility               |

### Backend commands

| Tool                | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `agda_compile`      | Compile a module through Agda using a selected backend (`Cmd_compile`) |
| `agda_backend_top`  | Send backend-specific top-level payload (`Cmd_backend_top`)            |
| `agda_backend_hole` | Send backend-specific goal-hole payload (`Cmd_backend_hole`)           |

### Goal inspection and proof interaction

These tools require a file to be loaded first via `agda_load`.

| Tool                           | Description                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `agda_goal_type`               | Show the goal type and local context for one interaction point                            |
| `agda_goal`                    | Show only the goal type for one interaction point                                         |
| `agda_context`                 | Show only the local context for one interaction point                                     |
| `agda_metas`                   | List unsolved goals in the loaded file                                                    |
| `agda_case_split`              | Case-split on a variable in a goal and return the generated clauses                       |
| `agda_give`                    | Fill a goal with a proposed expression                                                    |
| `agda_refine`                  | Refine a goal by applying a function or constructor                                       |
| `agda_refine_exact`            | Refine a goal using Agda's exact `Cmd_refine` command                                     |
| `agda_intro`                   | Introduce a lambda or constructor using Agda's exact `Cmd_intro` command                  |
| `agda_auto`                    | Attempt proof search for a single goal                                                    |
| `agda_auto_all`                | Attempt proof search across all goals                                                     |
| `agda_solve_all`               | Solve goals that have unique solutions                                                    |
| `agda_solve_one`               | Solve one goal if Agda already knows it has a unique solution                             |
| `agda_compute`                 | Normalize an expression, either in goal context or at top level                           |
| `agda_infer`                   | Infer the type of an expression, either in goal context or at top level                   |
| `agda_constraints`             | Show Agda's current constraint set                                                        |
| `agda_elaborate`               | Elaborate an expression in a goal context                                                 |
| `agda_helper_function`         | Generate a helper function type from a goal-local expression                              |
| `agda_goal_type_context_infer` | Show a goal's context and type together with the inferred type of an expression           |
| `agda_goal_type_context_check` | Show a goal's context and type together with the checked elaborated form of an expression |

### Navigation and environment inspection

| Tool                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `agda_read_module`        | Read a module from disk with line numbers                             |
| `agda_list_modules`       | List Agda modules under a tier or directory segment                   |
| `agda_check_postulates`   | Check a file for `postulate` declarations                             |
| `agda_search_definitions` | Search source files for matching identifiers or text                  |
| `agda_why_in_scope`       | Explain why a name is in scope, either at top level or in a goal      |
| `agda_show_module`        | Show what a module exports                                            |
| `agda_search_about`       | Search the loaded environment for names whose types mention the query |

## Typical interactive workflow

```text
1. agda_load file="MyModule.agda"
     → Status: OK, 3 unsolved goals (?0, ?1, ?2)

2. agda_goal_type goalId=0
     → Context: (x : Nat), (p : x ≡ zero)
     → Goal: x + zero ≡ x

3. agda_auto goalId=0
     → No automatic solution found.

4. agda_elaborate goalId=0 expr="+-identityʳ x"
     → Elaborated: +-identityʳ x : x + zero ≡ x

5. agda_give goalId=0 expr="+-identityʳ x"
     → Goal solved.

6. Apply edits to the source file if needed.

7. agda_load file="MyModule.agda"
     → Reload to refresh remaining goals.
```

## Stateless vs stateful operations

Use `agda_typecheck` when you want:

- a quick yes or no answer about whether a file checks,
- error and warning output only,
- no interactive goal information,
- no persistent Agda session.

Use `agda_load` when you want:

- stable goal IDs,
- interactive commands against holes,
- proof search, refinement, elaboration, and local type information,
- a persistent Agda subprocess.

## Environment variables

| Variable                     | Default | Description                                                            |
| ---------------------------- | ------- | ---------------------------------------------------------------------- |
| `AGDA_MCP_ROOT`              | `cwd`   | Root directory used to resolve Agda files and relative extension paths |
| `AGDA_MCP_EXTENSION_MODULES` | unset   | Colon-separated list of extension module paths or package specifiers   |

## Extension modules

The core server is intentionally generic. Project-specific workflows can be added
through external extension modules loaded at startup.

Values in `AGDA_MCP_EXTENSION_MODULES` are resolved as follows:

- absolute filesystem paths are used directly,
- relative filesystem paths are resolved relative to `AGDA_MCP_ROOT`,
- `file://` specifiers are used as-is,
- anything else is treated as a normal module specifier.

An extension can export `register` or multiple functions whose names begin with
`register`. Each function receives the MCP server instance, the shared
`AgdaSession`, and the resolved repo root.

### Example extension

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgdaSession } from "agda-mcp-server";

export function register(
  server: McpServer,
  session: AgdaSession,
  repoRoot: string,
): void {
  server.tool(
    "my_custom_tool",
    "Example custom Agda tool",
    {
      expr: z.string(),
    },
    async ({ expr }) => {
      const loadedFile = session.getLoadedFile();

      return {
        content: [
          {
            type: "text",
            text: `repoRoot=${repoRoot}\nloadedFile=${loadedFile ?? "(none)"}\nexpr=${expr}`,
          },
        ],
      };
    },
  );
}
```

Then start the server with something like:

```bash
AGDA_MCP_ROOT=. AGDA_MCP_EXTENSION_MODULES=dist/my-extension.js node dist/index.js
```

## Development

### Scripts

| Script                     | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `npm run build`            | Compile TypeScript into `dist/`                                 |
| `npm run dev`              | Run the TypeScript entry point directly with `tsx`              |
| `npm test`                 | Build first, then run the Node test suite                       |
| `npm run test:integration` | Run the Agda-backed integration test scaffold                   |
| `npm run verify`           | Run tests and verify package contents with `npm pack --dry-run` |

### Local development flow

```bash
npm install
npm run build
npm test
npm run verify
```

### Tests

The test suite currently focuses on lightweight, deterministic behavior such as:

- response parsing,
- Agda command string escaping,
- Agda binary discovery,
- session cleanup behavior.

The tests intentionally avoid depending on a live Agda installation so they can
run reliably in normal CI environments.

An integration scaffold is also available for environments where Agda is
installed:

```bash
RUN_AGDA_INTEGRATION=1 npm run test:integration
```

Backend integration commands can be exercised with:

```bash
RUN_AGDA_BACKEND_INTEGRATION=1 AGDA_BACKEND_EXPR=GHC npm run test:integration
```

`AGDA_BACKEND_EXPR` accepts backend constructor expressions such as `GHC`,
`GHCNoMain`, `LaTeX`, `QuickLaTeX`, or `OtherBackend "Name"`.

## Publishing

The package is configured for public npm publishing.

Before publishing:

1. Update the version in `package.json`.
2. Run `npm run verify`.
3. Publish with npm using your normal release process.

The `prepublishOnly` script runs verification automatically before publish.

Only the following files are published:

- `dist/`
- `README.md`
- `LICENSE`

## Continuous integration

This repository includes a GitHub Actions workflow at
[.github/workflows/ci.yml](.github/workflows/ci.yml) that:

- installs dependencies with `npm ci`,
- runs on pushes and pull requests,
- verifies the package on Node.js 24.

## Community and maintenance files

This repository also includes:

- [CONTRIBUTING.md](CONTRIBUTING.md) for contributor setup and workflow guidance
- [SECURITY.md](SECURITY.md) for vulnerability reporting guidance
- [CHANGELOG.md](CHANGELOG.md) for release history
- [.github/ISSUE_TEMPLATE/config.yml](.github/ISSUE_TEMPLATE/config.yml) and issue forms for structured reports
- [.github/pull_request_template.md](.github/pull_request_template.md) for consistent pull requests
- [.nvmrc](.nvmrc) and the `packageManager` field in [package.json](package.json) for local toolchain alignment

## Architecture overview

```text
src/
  index.ts
    Bootstraps the MCP server, registers core tools, and loads extensions.

  agda-process.ts
    Public barrel for the Agda integration layer.

  agda/
    session.ts
      Owns the Agda subprocess, transport, buffering, and session state.
    batch.ts
      Stateless batch type-checking.
    goal-operations.ts
      Goal-centric interactive commands.
    expression-operations.ts
      Expression normalization and type inference.
    advanced-queries.ts
      Constraints, scope, elaboration, module inspection, and search.
    display-operations.ts
      Highlighting and display-toggle command delegates.
    backend-operations.ts
      Compile and backend payload command delegates.
    backend-expression.ts
      Backend expression validation and normalization.
    response-parsing.ts
      Helpers for extracting user-facing messages from Agda responses.
    types.ts
      Shared types for the Agda integration layer.

  protocol/
    command-registry.ts
      Upstream command inventory and parity metadata.
    responses/
      goal-display.ts
      proof-actions.ts
      process-controls.ts
      backend.ts
        Focused response decoders per command family.

  tools/
    session.ts
      MCP tool registration for loading and status operations.
    proof.ts
      MCP tool registration for goal-oriented proof actions.
    navigation.ts
      MCP tool registration for source and environment navigation.
    display.ts
      MCP tool registration for highlighting and display toggles.
    backend.ts
      MCP tool registration for compile and backend payload commands.

  session/
    session-state.ts
      High-level session phase derivation used to keep process lifecycle concerns explicit.
```

## Protocol notes

The server communicates with Agda using the
[IOTCM protocol](https://hackage.haskell.org/package/Agda-2.7.0.1/docs/Agda-Interaction-Base.html)
over `--interaction-json` mode.

At a high level:

- commands are written to Agda on stdin as IOTCM strings,
- Agda emits newline-delimited JSON responses on stdout,
- stderr output is captured for diagnostics,
- session completion is inferred from status and running-info messages.

## Troubleshooting

### `agda` cannot be found

Make sure either:

- `agda` is installed and on your `PATH`, or
- `tooling/scripts/run-pinned-agda.sh` exists in the repo root.

### Goal IDs stop working

Goal IDs are tied to the current loaded file and the current Agda state. If the
source changed or you applied a case split, reload the file with `agda_load`.

### Top-level commands fail with "No file loaded"

Most interactive commands require an active loaded file because they need the
Agda session context. Start with `agda_load`.

### Proof search or elaboration returns unexpected output

Agda response formatting varies across commands. When in doubt, inspect the goal
again with `agda_goal_type` and retry with a simpler expression.

## License

This project is licensed under the MIT License. External extension modules may
use different licenses.
