# Release 0.7.0 — Triage

**Status:** planning — most of the original 0.7.0 candidate scope shipped in 0.6.5.
**Last updated:** 2026-04-15

---

## What shipped in 0.6.5 (from the original 0.7.0 scope)

All of the original release gate criteria from issue #22 were satisfied in
0.6.5:

| Original 0.7.0 requirement | Shipped |
|---|---|
| One-call session introspection (`agda_session_snapshot`) | ✅ #21 in PR #45 |
| Structured goal catalog (`agda_goal_catalog`) | ✅ #20 in PR #45 |
| Tool recommendation from session state (`agda_tool_recommend`) | ✅ #19 in PR #45 |
| Manifest-derived output schema discovery (`listToolSchemas`, `getToolSchemaEntry`) | ✅ #18 in PR #45 |
| Bug report/update bundle flow (`agda_bug_report_bundle`, `_update_bundle`) | ✅ #12 in PR #1 |
| Structured output rollout across all tools (`ToolEnvelope`, `classification`) | ✅ #11 across several PRs |
| Remaining semantic IOTCM parity (`Cmd_search_about_toplevel`, write-back, etc.) | ✅ #16 via PRs #35–#45 |
| `agda_tools_catalog` with capability awareness | ✅ manifest + `agda_tools_catalog` |

Conclusion: **0.6.5 satisfies the original 0.7.0 release gate.** The version
number was kept as a patch release because the changes were incremental rather
than constituting a paradigm shift in the server's external behaviour.

---

## What did not ship and belongs in 0.7.0

The candidate scope below is drawn from the remaining open items in
`docs/bug-reports/agent-ux-observations.md` and from the still-open issues.
Each item is ordered by impact on the agent-on-large-codebase use case.

### Must-have (0.7.0 gate)

1. **`agda_bulk_status` / cascade deduplication (§2.1)**
   Run a directory of Agda files in parallel or sequence and return a
   `{ file, status, rootCauseFile }` table. Cluster by shared upstream
   failure. Unblocks the "30-file survey costs 40 minutes" problem.
   Tracking: derive from issue #22 / agent-ux §2.1.

2. **Pre-load error classifier — `agda_triage_error` (§2.2)**
   Classify a raw Agda compiler error string into a machine-readable
   class (`mechanical-import`, `mechanical-rename`, `parser-regression`,
   `coverage-missing`, `proof-obligation`, `dep-failure`, `toolchain`)
   with a confidence score and suggested action. Eliminates the need
   for agents to pattern-match raw error text.
   Tracking: new issue needed.

3. **`agda_term_search` at module scope (§4.1)**
   Extend `agda_auto` / `agda_elaborate` to search terms across a
   whole loaded module instead of per-goal, reducing the
   three-round-trip pattern to one call on most simple applications.
   Tracking: new issue needed.

4. **Multi-file / project-wide proof-state summary (§5.3)**
   Per-subdirectory: total files, clean, with-holes, with-errors,
   with-postulates. Answers "how is `Foo/` doing overall?" without
   per-file typecheck calls.
   Tracking: new issue needed.

### Should-have

5. **`agda_suggest_import` — symbol reverse-index (§3.3)**
   "Which module should I import to bring `fooBar` into scope?"
   Whole-repo reverse index, ranked by fewest new imports.

6. **`agda_apply_rename` — structured rename via `agda_apply_edit` (§3.2)**
   Parse "did you mean" suggestions and apply them as structured diffs;
   optionally provide a stdlib migration map for known version churn.

7. **`agda_find_clash_source` (§3.1)**
   "Which `open` statement brought in the name that clashes with my
   local definition?" Returns both binding sites.

8. **`agda_type_search` — search by type pattern (§5.1)**
   Extend `agda_search_definitions` to accept a type pattern in addition
   to a name pattern.

### Nice-to-have / deferred

9. **Extension modules for literate Agda authoring (#33)**
   Scaffolding generators and prose/code boundary mapping. These belong
   in the extension system, not the core server.

10. **CI multi-version Agda matrix (#41)**
    Blocked on `setup-agda@v2` gaining bundles for 2.8.x/2.9.x.
    Track upstream; revisit when bundles appear.

11. **`--help` / `--version` CLI surface (#42)**
    Already shipped in 0.6.5.

---

## 0.7.0 release gate (proposed)

Treat 0.7.0 as gated on:

- `agda_bulk_status` with cascade deduplication (§2.1) — the single
  biggest throughput unlock for large-codebase agents
- `agda_triage_error` with mechanical-class detection (§2.2) — turns
  auto-repair from a heuristic into a first-class workflow
- `agda_term_search` at module scope (§4.1) — reduces interactive
  proof round-trips

Everything else on the should-have list is additive and can ship as
further patch releases after 0.7.0.

---

## How to track new 0.7.0 work

File new GitHub issues for each item above that doesn't already have
one. Reference this file in each issue for context. Close this file
from the milestone when the 0.7.0 gate criteria are all satisfied.
