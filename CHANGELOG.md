# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
