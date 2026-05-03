# Architecture

This file is the entry point for understanding the agda-mcp-server
codebase. It describes the layering, the major sub-systems, and the
conventions every contributor and assistant agent should know before
touching `src/`.

## Top-level layering

```
                       ┌──────────────┐
                  ┌────│ MCP transport │     stdio JSON-RPC
                  │    └──────────────┘
                  ▼
        ┌─────────────────────┐
        │  src/tools/         │     thin tool registration adapters,
        │                     │     output-envelope shaping, tool-error
        │                     │     translation
        └─────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  src/session/       │     load orchestration, project config,
        │                     │     proof-edit appliers, goal-position
        │                     │     scanning, command-completion logic
        └─────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  src/agda/          │     Agda subprocess + IOTCM transport,
        │                     │     wire-format normalization,
        │                     │     domain-specific operation modules
        └─────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │  src/protocol/      │     pure command-builder + response
        │                     │     decoder + flag/option validators
        └─────────────────────┘
```

The flow is one-way: `protocol` → `agda` → `session` → `tools`.
Anything flowing the other direction (a tool needing a protocol
helper) imports the inner module directly; the layers don't expose
each other through their barrels.

## Module-size convention

**Every source file in `src/` must stay at or under 500 lines.**
Files that exceed this are grab bags of mixed concerns and should be
split into cohesive sub-modules. When a single change pushes a file
past the ceiling, split rather than patch.

The current set of barrel files (each delegating to focused
sub-modules) all exist for this reason:

- `src/agda/agent-ux.ts` (71) → `error-classifier.ts`,
  `source-parsers.ts`, `refactor-helpers.ts`, `clause-fixity.ts`.
- `src/session/apply-proof-edit.ts` (37) → `safe-source-io.ts`,
  `apply-goal-edit.ts`, `apply-batch-edits.ts`, `apply-text-edit.ts`.
- `src/tools/agent-ux-tools.ts` (38) → `agent-ux/migration-tools.ts`,
  `agent-ux/edit-tools.ts`, `agent-ux/import-tools.ts`,
  `agent-ux/options-tools.ts`, `agent-ux/project-tools.ts`,
  `agent-ux/shared.ts`.

When adding a new tool to one of the existing groups, prefer
extending the relevant sub-module over inflating the barrel.

## Major sub-systems

### `src/protocol/` — IOTCM wire format

Pure functions only. Knows the shape of `IOTCM "<file>" NonInteractive
Direct (...)`, the JSON response decoders, and the validators that
gatekeep flag arrays going into `Cmd_load`. No side effects, no Agda
subprocess.

Key files:
- `command-builder.ts` — `command()`, `goalCommand()`, `quoted()`,
  `stringList()`, `boolLiteral()`. Single source of truth for IOTCM
  string assembly; no other module hand-builds command strings.
- `command-line-options.ts` — validates per-call flags going into
  `Cmd_load [String]`. Rejects blocked flags (`--interaction-json`,
  `--version`, etc.) and control-character / oversize inputs.
- `command-line-suggestions.ts` — Levenshtein-based "did you mean"
  hints against `COMMON_AGDA_FLAGS`.
- `profile-options.ts` — closed-set profile-option validator with
  mutual-exclusion enforcement.
- `responses/` — domain-specific decoders for Agda's
  `--interaction-json` output (load responses, goals, postulate sites,
  etc.).

### `src/agda/` — subprocess + protocol-aware operations

`AgdaSession` owns the long-lived `agda --interaction-json`
subprocess. The class file (`session.ts`) is intentionally a
lifecycle and command-queue façade only; cohesive blocks live in
sibling helper modules:

- `agda-process-spawn.ts` — `spawn(...)` + transport wiring.
- `agda-version-detection.ts` — pre-flight `Cmd_show_version` round
  trip and piggyback path with retry budget.
- `session-load-impl.ts` — `runLoad` / `runLoadNoMetas` (the heavy
  load orchestration extracted out so `session.ts` stays under the
  500-line ceiling).
- `agent-ux.ts` — barrel re-exporting:
  - `error-classifier.ts` — `classifyAgdaError`,
    `extractSuggestedRename`, `rewriteCompilerPlaceholders`,
    `normalizeConfidence`.
  - `source-parsers.ts` — `parseOptionsPragmas`,
    `parseAgdaLibFlags`, `parseModuleSourceShape`,
    `parseTopLevelDefinitions`, `extractPostulateSites`.
  - `refactor-helpers.ts` — `splitWords`, `matchesTypePattern`,
    `applyScopedRename`, `buildAutoSearchPayload`.
  - `clause-fixity.ts` — `inferMissingClauseArity`,
    `buildMissingClause`, `inferFixityConflicts`.

### `src/session/` — load orchestration + project config

Wraps the Agda layer with project-aware semantics:

- `project-config.ts` — `.agda-mcp.json` + `AGDA_MCP_DEFAULT_FLAGS`
  loader, validator, mtime+size cache. Distinguishes `file` /
  `env` / `system` warning sources.
- `project-config-diagnostics.ts` — formatter that maps each warning
  source to its `project-config-{source}` diagnostic kind and
  inline `config:` / `env:` / `system:` prefix.
- `apply-proof-edit.ts` — barrel for the four edit-applicator
  modules (see size-convention section above).
  - `safe-source-io.ts` — hardened reader (O_NOFOLLOW + size cap)
    and atomic writer (temp file + rename).
  - `apply-goal-edit.ts`, `apply-batch-edits.ts`,
    `apply-text-edit.ts` — three edit shapes, each with its own
    result type.
- `goal-positions.ts` — scans source for `{!!}` / `?` markers
  and resolves goal IDs back to byte offsets.
- `reload-and-diagnose.ts` — proof-action post-edit reload helper
  that uniformly surfaces `LoadResult.projectConfigWarnings`.
- `load-tool-shared.ts` — error-envelope helpers shared by
  `agda_load`, `agda_load_no_metas`, `agda_typecheck`. Every error
  path here emits a `nextAction` recovery hint.

### `src/tools/` — MCP adapter layer

Each tool registration is a thin adapter that:

1. Validates input via Zod.
2. Calls into `session/` or `agda/` for the actual work.
3. Wraps the result in a `ToolResult` envelope (`okEnvelope` or
   `errorEnvelope`) with `summary`, `classification`, `data`,
   `diagnostics`, and `provenance`.

Key files:
- `tool-envelope.ts` — `ToolDiagnostic` /
  `ToolResult` shape definitions, the envelope builders
  (`okEnvelope`, `errorEnvelope`, `makeToolResult`), and the
  diagnostic helpers (`infoDiagnostic`, `warningDiagnostic`,
  `errorDiagnostic`). The `nextAction` field on every diagnostic is
  load-bearing — every error helper across the codebase populates it.
- `tool-registration.ts` — `registerStructuredTool`,
  `registerTextTool`, `registerGoalTextTool` adapters. The two text
  variants run their body through `digestText()` so a multi-line
  body doesn't get duplicated into `summary`.
- `tool-errors.ts` — `ToolInvocationError` exception type and the
  central `toToolInvocationError()` translator that maps
  `PathSandboxError` and unexpected exceptions to envelopes with
  recovery hints.
- `agent-ux-tools.ts` — barrel for the 13-tool agent-UX group
  (see the size-convention section).

## Output envelope contract

Every tool returns a `ToolResult` with:

- `ok: boolean` — false implies the call failed.
- `summary: string` — **single-line** digest (≤ 200 chars). Multi-line
  bodies belong in the markdown text or in `data.text`, not here.
- `classification: string` — domain-specific status (e.g.
  `ok-complete`, `ok-with-holes`, `type-error`, `invalid-path`).
- `data: T` — structured payload matching the tool's
  `outputDataSchema`.
- `diagnostics: ToolDiagnostic[]` — severity-tagged messages, each
  carrying optional `code` and `nextAction` strings. Error
  diagnostics SHOULD include a `nextAction` describing recovery.
- `provenance` — server version, Agda version, file, protocol
  commands.
- `elapsedMs` — wall-clock timing.

## Project-level configuration

Three layers, merged inside `AgdaSession.load()` so every caller
(including internal reload paths in `agda_apply_edit`,
`agda_bulk_status`, etc.) gets the same defaults:

1. `.agda-mcp.json` at PROJECT_ROOT (`fileFlags`).
2. `AGDA_MCP_DEFAULT_FLAGS` env var (`envFlags`).
3. Per-call `commandLineOptions` (per-call wins on collision via
   last-wins dedup in `mergeCommandLineOptions`).

Validation runs at config-load time; bad flags become warnings on the
load response (`LoadResult.projectConfigWarnings`) rather than killing
the load. The schema lives at `schemas/agda-mcp.schema.json` and is
shipped with the npm package for IDE autocomplete via `$schema`.

## Static metadata convention

Pure data tables (rename maps, builtin migration records, parity
matrices, version-gating facts, source-extension lists) live in JSON
files under `src/<area>/data/` and are loaded + validated at module
init via `loadJsonData()` from `src/json-data.ts`. The build's
`scripts/copy-json-assets.mjs` post-step copies every `*.json` under
`src/` into `dist/` so the runtime can resolve them. Validation logic
and derived tables stay in TypeScript.

Examples in tree:
- `src/agda/data/agda-source-extensions.json`,
  `src/agda/data/agda-feature-flags.json`.
- `src/protocol/data/protocol-command-registry.json`,
  `src/protocol/data/protocol-parity-overrides.json`.
- `src/tools/agent-ux/data/stdlib-migrations.json`,
  `src/tools/agent-ux/data/builtin-migrations.json`.

## Where to find the rest

- `README.md` — install, configuration, end-user tool catalog.
- `CHANGELOG.md` — release notes.
- `docs/extensions.md` — `AGDA_MCP_EXTENSION_MODULES` API.
- `docs/assistant-workflows.md` — recommended agent patterns.
- `tooling/protocol/data/` — cross-version Agda protocol references.
