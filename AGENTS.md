# AGENTS.md

This file is for coding agents working in this repository.

## Purpose

`agda-mcp-server` is a stateful MCP server for Agda. It keeps a long-running
Agda process alive in `--interaction-json` mode and exposes proof-oriented
tools over MCP.

Core goals for changes in this repo:

- Keep the implementation modular and compositional.
- Prefer typed domain layers over tool-local ad hoc logic.
- Preserve or improve MCP semantic output quality.
- Add at least unit tests for every new module or helper.
- All new features and bug fixes must follow property-based TDD.

Terminology:

- `SERVER_REPO_ROOT`
  The root of the `agda-mcp-server` repository itself.
- `PROJECT_ROOT`
  The root of the project/workspace the MCP server is operating on.

Do not conflate these. For example, when this server is used from another repo,
that consumer repo is the `PROJECT_ROOT`, not the `SERVER_REPO_ROOT`.

## Architecture

Main layers:

- `src/agda/`
  Agda process/session management, wire normalization, response parsing, and
  domain operations.
- `src/session/`
  Session-domain helpers and MCP registration support for session-oriented tools.
- `src/tools/`
  Thin MCP registration adapters and output presentation helpers.
- `src/protocol/`
  Protocol metadata, command builders, and response decoders.
- `src/reporting/`
  Bug bundles, fingerprints, and other reporting-specific logic.

Important files:

- `src/index.ts`
  Server entrypoint and tool registration composition.
- `src/agda/session.ts`
  Stateful Agda process manager. Treat transport/completion changes here as
  high-risk.
- `src/tools/manifest.ts`
  Runtime SSOT for exposed tools, categories, and schema field names.
- `src/protocol/command-builder.ts`
  Typed Agda command construction. Prefer this over hand-built command strings.
- `test/fixtures/agda/fixture-matrix.json`
  SSOT for the expanding Agda fixture matrix.

## Testing

Normal fast suite:

```bash
npm test
```

Build only:

```bash
npm run build
```

Live Agda integration:

```bash
RUN_AGDA_INTEGRATION=1 node --test test/integration/agda/agda-load.test.js
RUN_AGDA_INTEGRATION=1 node --test test/integration/agda/agda-fixture-matrix.test.js
RUN_AGDA_INTEGRATION=1 node --test test/integration/mcp/mcp-server.test.js
```

Built-server MCP end-to-end gate:

```bash
RUN_AGDA_INTEGRATION=1 npm run test:e2e
RUN_AGDA_INTEGRATION=1 RUN_AGDA_BACKEND_INTEGRATION=1 npm run test:e2e
```

Convenience scripts:

```bash
npm run test:integration:fixtures
npm run test:integration:mcp
```

Notes:

- Integration tests are intentionally gated by `RUN_AGDA_INTEGRATION=1`.
- `test/fixtures/e2e/mcp-tool-coverage.json` is the SSOT for which built-server
  MCP scenario covers each exposed core tool.
- Some live commands can be slow. If a user is available to run them locally,
  prefer giving them the exact command and asking for the log file.
- New features and bug fixes should start with failing tests.
- Add property-based tests for invariants whenever the behavior can be stated
  generatively.
- Do not assume a functional fix is fully proven until it passes live
  Agda-backed tests, not just unit tests.
- The fixture matrix is the preferred place to add new Agda cases before adding
  ad hoc fixture lists in tests.
- Useful live-debug env vars:
  `AGDA_FIXTURE_FILTER`, `AGDA_FIXTURE_PHASES`,
  `AGDA_MCP_COMMAND_TIMEOUT_MS`, `AGDA_MCP_IDLE_COMPLETION_MS`,
  `AGDA_MCP_WAITING_SENTRY_MS`.

## MCP harness

This repo includes a local MCP stdio harness for end-to-end debugging of the
built server:

```bash
npm run mcp:local -- list-tools
npm run mcp:local -- server-info
npm run mcp:local -- call-tool agda_tools_catalog '{}'
npm run mcp:local -- call-tool agda_load '{"file":"WithHoles.agda"}' test/fixtures/agda
```

Related files:

- `scripts/mcp-local-client.mjs`
- `test/helpers/mcp-harness.js`
- `test/integration/mcp/mcp-server.test.js`

Use this for real MCP-layer debugging. Do not make the server call itself
through MCP in production code.

## Official protocol reference

For protocol and parity work, prefer official Agda docs plus repo-local live
fixtures over third-party extensions.

This repo can hydrate a local, gitignored cache of official Agda reference
pages:

```bash
npm run protocol:refresh:official
```

This writes into `.local-reference/agda-protocol/` with:

- `manifest.json`
  crawl metadata plus cached page inventory
- `search-index.json`
  quick textual lookup/index metadata
- `all-content.txt`
  concatenated readable text across cached pages
- `pages/<page-id>/raw.html`
- `pages/<page-id>/pretty.html`
- `pages/<page-id>/content.txt`
- `pages/<page-id>/page.json`

Committed source metadata for that cache lives in:

- `tooling/protocol/data/official-reference-sources.json`

Use the local cache as the day-to-day protocol SSOT when doing parity work, but
remember the ultimate source of truth is the official Agda documentation those
files were fetched from.

## Fixtures

Agda fixtures live in `test/fixtures/agda/`.

Rules:

- Add new fixtures through `test/fixtures/agda/fixture-matrix.json` when possible.
- Prefer small, single-purpose modules that isolate one language or protocol
  behavior.
- Keep fixtures useful for both direct `AgdaSession` tests and MCP harness tests.

Good fixture categories:

- hole shapes
- record/copattern behavior
- where/let/with blocks
- module/import visibility
- scope/search behavior
- flags and language options
- deliberate parse/type/library failures

## Coding guidance

- Prefer `rg` for file and text search.
- Use `apply_patch` for manual edits.
- Do not introduce new monolithic handlers.
- Keep `src/tools/` thin; move reusable logic into `src/agda/`, `src/session/`,
  `src/protocol/`, or `src/reporting/` as appropriate.
- Prefer `zod` v4 APIs. The repo now targets Zod 4 directly.
- Prefer manifest-driven behavior over hardcoded duplicated tool inventories.
- Prefer typed command construction via `src/protocol/command-builder.ts`.

## Commit strategy

Prefer multiple coherent commits over one large mixed commit. Good split shapes:

- session/completeness semantics
- protocol command-construction refactors
- MCP harness or integration coverage
- docs/templates/test-only changes

## When investigating bugs

Work from the lowest trustworthy layer upward:

1. Agda raw responses / session transport
2. response normalization and decoders
3. domain result shaping
4. MCP tool envelopes
5. MCP client/harness behavior

For reporting or issue updates, use the structured bug-bundle path rather than
inventing a new format.

## TDD discipline

For all new features and bug fixes:

1. Add or tighten failing tests first.
2. Prefer including a property-based test for invariants and totality.
3. Add or expand real Agda fixtures when the behavior depends on Agda semantics.
4. Only then implement the fix.
