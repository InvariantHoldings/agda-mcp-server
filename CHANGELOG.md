# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Configurable Agda CLI flags for `Cmd_load`** (#49) — `agda_load` and
  `agda_typecheck` accept a new `commandLineOptions` array that is passed
  through to Agda's `Cmd_load` `[String]` argument. Validated at the
  tool boundary (consistent with existing `profileOptions` semantics):
  invalid or session-conflicting flags (`--interaction*`, `--version`,
  `-V`, `-?`, etc.) are rejected with an `errorEnvelope` before the
  subprocess sees them. Case-sensitive matching for short flags
  (`-V` blocked, `-v` allowed); case-insensitive for long flags.
- **`.agda-mcp.json` project config** — a JSON config file at PROJECT_ROOT
  sets persistent `commandLineOptions` defaults. Loaded once per
  `agda_load` and cached by file mtime + size for repeated calls.
  UTF-8 BOMs are stripped; oversize files (>256 KiB) are refused with
  a warning rather than read into memory; unknown top-level keys produce
  a warning so typoed config keys (e.g. `commandlineoptions`) are not
  silently ignored.
- **`AGDA_MCP_DEFAULT_FLAGS` env var** — space-separated default flags
  alternative to the JSON config. Validated the same as file flags;
  invalid env entries surface as warnings on every load instead of
  silently corrupting the option list.
- **`agda_project_config` tool** — agent-facing introspection tool that
  returns the resolved project config (file flags, env flags, effective
  deduplicated flags) along with any validation warnings (unknown keys,
  invalid flag syntax, oversize file). Lets an agent confirm which flags
  will apply to subsequent loads without having to run a load first.
- **JSON schema for `.agda-mcp.json`** — published at
  `schemas/agda-mcp.schema.json` (and shipped with the npm package) for
  IDE autocompletion via the standard `$schema` field.
- **Project-config diagnostics on every load** — `agda_load`,
  `agda_typecheck`, `agda_reload`, `agda_apply_rename`,
  `agda_add_missing_clauses`, and every proof-action reload (give,
  refine, case_split, auto, solve, intro) now surface
  `LoadResult.projectConfigWarnings` either as structured tool
  diagnostics or as a `**Project-config warnings:**` markdown section,
  so an agent sees the failure inline with the load that consumed the
  bad config — not only when calling `agda_load` explicitly.
- **"Did you mean ...?" suggestions for typoed flags** — invalid
  command-line options now get a Levenshtein-matched hint pointing at
  the closest entry in `COMMON_AGDA_FLAGS`. `Werror` (forgot the
  dashes) → `Did you mean '--Werror'?`. Same treatment for typoed
  `.agda-mcp.json` keys: `commandlineoptions` (case typo) →
  `Did you mean 'commandLineOptions'?`. Conservative thresholds (≤2
  for flags, ≤3 case-insensitive for keys) avoid second-guessing real
  but obscure inputs.
- **`LoadResult.projectConfigWarnings`** — public load-result field
  so any tool surfacing a load result can render config warnings
  consistently. Centralises the wire format previously duplicated at
  each tool boundary.
- **Per-element validation of `commandLineOptions` arrays** — a
  config like `["--safe", 42, "--Werror"]` now keeps the two valid
  flags and emits one warning per offending entry (with index and
  type label: `commandLineOptions[1] is not a string (got number)`),
  instead of dropping the whole array on the first non-string.
- **Control-character + length defenses on flags** — a flag
  containing a newline / NUL / tab / DEL is now rejected with a
  `control character` error (would otherwise corrupt IOTCM
  transport, which serialises commands one-per-line). Flags longer
  than 1024 chars are rejected with a truncated-preview error; the
  longest real Agda flag is well under this and a multi-KB string
  is almost certainly an accidental paste of a binary blob.

### Fixed

- **`projectConfigDiagnostics()` mis-labelled `system`-source warnings
  as `config:`** — the binary `env` / `config` ternary swallowed the
  `system` source even though the diagnostic kind was correctly
  `project-config-system`. The visible message text now matches the
  kind via a `prefixForWarningSource()` mapping; the
  `agda_project_config` tool's inline duplicate of the same logic now
  routes through the shared formatter.
- **System-level config-read failures are now tagged `system`, not `file`**
  — `statSync` / `readFileSync` failures (permission denied, deletion
  race) are infrastructure problems, not "your config content is
  wrong". An agent can now distinguish `the disk says no` from `the
  JSON is malformed` by looking at the warning source.
- **`agda_effective_options` source attribution** — flags that appeared
  in BOTH `.agda-mcp.json` and `AGDA_MCP_DEFAULT_FLAGS` are partitioned
  at config-load time (`fileFlags` / `envFlags`) so
  `agda_effective_options` reports each source unambiguously,
  including the case where the same flag appears in both.
- **`-V` blocking case-sensitivity** — the previous lower-casing pass
  meant `-V` (Agda's short `--version`) and `-v` (verbosity) collapsed
  to the same key, blocking the verbosity flag too. Short flags now use
  case-sensitive matching (`-V`, `-?` blocked), long flags case-insensitive.

### Changed

- **`ProjectConfig` shape** — internal API change: `commandLineOptions`
  field replaced by separate `fileFlags` / `envFlags` arrays plus a
  `warnings` array of validation issues. External callers can use
  `effectiveProjectFlags(config)` to get the combined list.
- **Project-config merge centralised in `AgdaSession.load()`** — every
  caller of `session.load()` now picks up `.agda-mcp.json` and
  `AGDA_MCP_DEFAULT_FLAGS` defaults, not just `agda_load` and
  `agda_typecheck`. Previously `agda_apply_edit`'s post-edit reload,
  `agda_bulk_status`, and `analysis-tools.ts`'s revalidation bypassed
  the merge, producing inconsistent typechecking behavior under a
  shared project config. Validation warnings now ride back on
  `LoadResult.projectConfigWarnings` so any tool surfacing a load
  result can display them inline.

## [0.6.6] - 2026-04-16

### Fixed

- **False `ok-complete` on loads with source holes** — `agda_load` and
  `agda_load_no_metas` could report `ok-complete` when explicit hole markers
  (`{!!}`, `?`, `{! expr !}`) existed in the source but the Agda protocol
  under-reported goals (e.g. holes inside `abstract` blocks reported as
  invisible goals only). A gated source-level hole scan now detects these
  markers and prevents false-positive `ok-complete` classification.
- **`invisibleGoalCount` undercount** — when multiple `AllGoalsWarnings`
  display events occur during a single load, the invisible goal count is now
  preserved as the maximum across events (not the last event's count).
- **Strict-load enforcement** — `agda_load_no_metas` now forces `type-error`
  classification whenever any holes or metas remain (visible goals, invisible
  goals, or source-level hole markers). Previously it could succeed despite
  source holes when the protocol reported zero goals.

### Added

- **IOTCM protocol parity — invisible goal decoding** — invisible goals
  (unsolved metavariables) are now structurally decoded from the real `NamedMeta`
  wire format (`{name: string, range: Range}`), matching the official Agda
  Haskell `encodeTCM NamedMeta` instance across v2.7.0.1, v2.8.0, and master.
  They are exposed as `DecodedInvisibleGoal` entries (name + type) in
  `DecodedLoadDisplay`, instead of being discarded and kept as a count only.
- **Cross-version protocol reference** — added
  `tooling/protocol/data/official-cross-version-notes.json` documenting the
  stable JSON field mapping for `AllGoalsWarnings`, `InteractionId`, and
  `NamedMeta` across representative Agda versions, sourced from the official
  Agda Haskell sources.
- **New Agda fixtures** — `MixedHoleStyles.agda`, `HoleInStringComment.agda`,
  `AbstractHoleMultiple.agda`, `MixedVisibleInvisible.agda`,
  `PostulateAndHole.agda`, `NestedAbstractHole.agda`,
  `MultiPostulateComplete.agda`, `AbstractComplete.agda` — all registered in
  the fixture matrix for integration testing.
- **Protocol conformance stress tests** — new fixtures stress-testing edge
  cases: multiple holes in abstract blocks (invisible-goal-only reporting),
  mixed visible + invisible holes, postulate + hole coexistence, nested abstract
  modules with holes, multi-postulate completeness, and abstract-complete
  (no-hole abstract blocks).

### Changed

- **Classification consolidation** — removed dead `classifyParsedLoad()` helper
  and consolidated into a shared `classifyLoadResult()` function that accounts
  for protocol goals, invisible goals, and source-level hole markers in one
  place.
- **Strict-load classification simplification** — `runLoadNoMetas` classification
  now uses only `"ok-complete"` / `"type-error"` (removed unreachable
  `"ok-with-holes"` branch).

## [0.6.5] - 2026-04-14

### Added

- **`agda_session_snapshot`** — one-call agent introspection tool that returns
  the full session state: loaded file, phase, goal counts, completeness,
  staleness, and prioritised suggested next actions (#21)
- **`agda_goal_catalog`** — returns a structured catalog of all open goals in
  one call: goal ID, type, context entries with implicit flags, splittable
  variables, and per-goal action suggestions (`give`, `refine`, `case_split`,
  `auto`, `intro`) (#20)
- **`agda_tool_recommend`** — suggests likely next MCP tool calls based on the
  current semantic proof state, ordered by priority with rationale, pre-filled
  arguments, and blockers (#19)
- **`agda_cache_info`** — reports the `.agdai` cache layout for the loaded file,
  both the `_build/` separated path and the source-adjacent fallback
- **`agda_impact`** — answers "which files transitively import this one?",
  returning both direct and transitive dependents and dependencies; graph is
  rebuilt from disk each call so newly added files are visible without a
  server restart
- **`--help` / `--version` CLI flags** — running `agda-mcp-server --help` or
  `agda-mcp-server --version` now prints usage information and exits cleanly
  instead of starting the MCP server (#42)
- **Proof-action write-back** — `agda_give`, `agda_refine`, `agda_refine_exact`,
  `agda_intro`, `agda_auto`, `agda_case_split`, `agda_solve_one`, and
  `agda_solve_all` now persist edits to the source file and auto-reload by
  default (`writeToFile: true`); pass `writeToFile: false` for session-only
  behaviour
- **`agda_apply_edit`** — new tool for non-goal edits (imports, renames, typos)
  that performs a round-trip text substitution and reloads; bypasses the
  session-error gate so it can be used to repair a `type-error` state
- **Goal-ID diffs in reload diagnostics** — every reload response now includes
  `{solved, new, remaining}` goal-ID sets so agents can track goals across edits
  without re-identifying by type
- **Wall-clock timing (`elapsedMs`)** — all MCP tool responses carry an
  `elapsedMs` field on the envelope; tool summaries include elapsed time (e.g.
  "Loaded Foo.agda with classification ok-complete (42ms)")
- **Agda `--profile` support** — `agda_load` and `agda_typecheck` accept an
  optional `profileOptions` parameter; profiling output is collected from
  `DisplayInfo/Time` responses and returned in the tool payload
- **`forceRecompile` on `agda_load`** — escape hatch to bust the `.agdai` cache
  for the current file when stale interface files cause unexpected failures
- **Runtime Agda version detection** — `AgdaSession` auto-detects the installed
  Agda version on first process start via `Cmd_show_version` and exposes it via
  `getAgdaVersion()`; capabilities and file discovery are gated on the detected
  version
- **Version-gated file discovery** — `agda_list_modules` and
  `agda_search_definitions` now recognise literate Agda extensions
  (`.lagda.md`, `.lagda.rst`, `.lagda.org`, etc.) based on what the installed
  Agda version actually supports (#30, #31)
- **Literate Agda extraction for `agda_read_module`** — new `codeOnly` parameter
  strips prose and returns only Agda code blocks from all seven literate formats
  (`.lagda`, `.lagda.tex`, `.lagda.md`, `.lagda.typ`, `.lagda.rst`,
  `.lagda.org`, `.lagda.tree`); has no effect on plain `.agda` files (#32)
- **`agda_list_modules` pagination** — new `offset`, `limit`, and `pattern`
  parameters prevent token-budget overruns on large codebases; every response
  carries the unfiltered total module count; default page size 25
- **Manifest-derived output schemas** — `getToolSchemaEntry()` and
  `listToolSchemas()` expose Zod-derived field→type summaries for every
  registered tool, enabling agent-readable schema discovery (#18)
- **`invisibleGoalCount` in session state** — `AgdaSession` now persists the
  count of invisible goals from load results, surfaced via
  `getInvisibleGoalCount()` and wired into snapshot and catalog tools
- **Session provenance stamping** — every tool response includes
  `serverVersion` and (best-effort) `agdaVersion` in the provenance block so
  agents always know which toolchain produced a given response
- **Session-history tracking** — `agda_load` records `lastClassification` and
  `lastLoadedAt` and emits a `session-regression` diagnostic when a previously
  complete file regresses to `type-error`
- **`lastCheckedLine` on `agda_load`** — surfaces the earliest error line so
  agents can pinpoint where type-checking stopped on a failure; a
  `scope-check-extent` info diagnostic flags when `hasHoles` may be
  under-counted due to an early abort
- **`agda_metas` file attribution** — response now includes `loadedFile`,
  `errorsByFile`, and `warningsByFile` arrays; each group carries
  `ownedByLoadedFile` so callers can immediately distinguish errors in the
  loaded file from errors in transitive dependencies
- **Literate Agda test fixtures** — fixtures for all seven literate formats
  (`.lagda`, `.lagda.tex`, `.lagda.md`, `.lagda.rst`, `.lagda.org`,
  `.lagda.tree`, `.lagda.typ`) added to the fixture matrix with per-format
  minimum Agda version requirements; integration tests skip gracefully on
  older installs
- **Expanded fixture corpus** — 19 additional fixtures covering type errors,
  parse errors, missing imports, universe levels, `--with-K`, `--rewriting`,
  `--sized-types`, `--cubical`, `--cumulativity`, `--guardedness`, deep import
  chains, mutual recursion, and mixed holes/errors

### Fixed

- **`agda_typecheck` / `agda_load` session-state desync** — `agda_typecheck`
  now routes through the singleton `AgdaSession`; `agda_session_status` always
  reflects the most-recent typecheck (#39)
- **Query tools unavailable on type-error** — `agda_why_in_scope`,
  `agda_infer`, `agda_compute`, `agda_search_about`, and `agda_show_module` now
  return an `unavailable` result when the session's last load was a `type-error`,
  preventing incorrect happy-path payloads over a broken session state
- **`Cmd_constraints` version gating** — Agda 2.9.0 requires a `Rewrite`
  argument that earlier versions reject; `buildConstraintsCommand` now selects
  the correct wire shape based on the detected Agda version (≥ 2.9.0 uses
  rewrite-mode form; earlier uses the bare form)
- **`agda_session_snapshot` E2E coverage** — the tool was missing from the MCP
  e2e coverage fixture matrix and is now correctly tracked
- **Literate fenced-block extraction** — rewritten to track non-Agda blocks
  separately, preventing false matches when `` ```agda `` text appears inside
  other fenced blocks; all four delimited extractors now recover from
  unclosed blocks
- **Tree-format literate extraction** — fixed an off-by-one in `startLine`
  calculation when `\agda{` has code on the same line as the opening brace
- **`agda_tool_recommend` duplicate recommendations** — stale + type-error
  combined state no longer produces duplicate entries
- **Tool gates with `nextAction` recovery hint** — the `session-unavailable`
  error diagnostic now also emits a companion `recovery-hint` info diagnostic
  with `nextAction: "agda_load"`, giving agents a machine-readable recovery
  path

### Changed

- `agda_session_snapshot` and `agda_goal_catalog` surface explicit
  `starting`/`exiting` phase states, matching all other phase-aware tools
- Property-based test coverage expanded to bug-report bundles,
  completeness classification, tool envelope invariants, and literate
  extraction across all seven formats
- CI now installs Agda 2.6.4.3 (pinned) with recommended stdlib via
  `wenkokke/setup-agda@v2` and runs the full integration test suite on every
  push; Copilot coding agent also preconfigured with live Agda

### Security

- **Shell injection fix** — `agda --version` pre-flight now uses
  `execFileSync(bin, ["--version"], { shell: false })` instead of the former
  `execSync` string form, eliminating CWE-78 shell-command-injection exposure
  when `AGDA_BIN` or `AGDA_MCP_ROOT` contains shell metacharacters
- **Dependency security updates** — `hono` 4.12.8 → 4.12.12 (fixes middleware
  bypass, path traversal in SSG, IP restriction bypass, and cookie validation
  vulnerabilities); `@hono/node-server` 1.19.11 → 1.19.13; `vite` 8.0.3 →
  8.0.5

## [0.6.4] - 2026-04-01

### Fixed

- **`Cmd_constraints` IOTCM protocol error** — the command was incorrectly sent with a `Normalised` rewrite argument that Agda cannot parse; it is now sent as a bare command
- **`Cmd_tokenHighlighting Remove` deleted source files** — the `Remove` flag tells Agda to delete the file at the given path after reading it; the server was passing `.agda` source file paths, causing silent source file deletion. The `remove` parameter has been removed from the tool interface
- **Concurrent IOTCM command serialization** — commands are now queued via a promise chain to prevent interleaved protocol responses
- **`Cmd_constraints` normalization for Agda 2.9.0** — GiveResult rendering updated for upstream protocol changes
- **Stale process cleanup** — session destroy now reliably resets mutable state
- **AGDA_DIR validation** — reuse stable AGDA_DIR when explicitly set via environment

### Changed

- **Test suite migrated from `node:test` to Vitest with TypeScript** (#27) — 93 test files converted from JS to TS with full type discipline; tests now import source directly instead of compiled `dist/`; `fast-check` upgraded to v4 via `@fast-check/vitest`
- Removed `linguist-detectable=false` overrides from `.gitattributes` — repo language stats now reflect the actual TypeScript codebase

### Security

- Path sandboxing hardened across file tools and symlink resolution
- Pinned CI actions, npm audit clean, tightened SECURITY.md

## [0.5.0] - 2026-03-24

### Added

- protocol inventory for upstream IOTCM coverage tracking
- exact MCP tools for `Cmd_goal_type`, `Cmd_context`, `Cmd_goal_type_context_check`, `Cmd_goal_type_context_infer`, `Cmd_refine`, `Cmd_intro`, and `Cmd_solveOne`
- reusable protocol response decoders for goal displays and proof actions
- strict load support via `agda_load_no_metas`
- process control tools for `Cmd_abort` and `Cmd_exit`
- highlighting and display-control tools for `Cmd_load_highlighting_info`, `Cmd_tokenHighlighting`, `Cmd_highlight`, `ShowImplicitArgs`, `ToggleImplicitArgs`, `ShowIrrelevantArgs`, and `ToggleIrrelevantArgs`
- backend command tools for `Cmd_compile`, `Cmd_backend_top`, and `Cmd_backend_hole`
- explicit session phase derivation in `src/session/session-state.ts`

## [0.4.0] - 2026-03-22

### Added

- professional repository hygiene files
- automated unit tests and verification scripts
- public package metadata for npm publishing
- GitHub Actions CI workflow
- comprehensive README, contribution guide, security policy, changelog, and community templates
- Node 24 standardization with [.nvmrc](.nvmrc)
- Agda integration test scaffold
