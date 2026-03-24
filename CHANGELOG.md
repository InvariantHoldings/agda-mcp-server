# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
