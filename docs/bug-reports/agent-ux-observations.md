# Agent UX observations from a multi-file proof-repair session

**Server version:** `agda-mcp-server` 0.6.4
**Agda version:** 2.9.0 (pinned)
**Consumer:** an AI coding agent performing mechanical repair and theorem
extension across a large multi-file Agda project (several hundred modules,
multiple subdirectories).
**Status:** working document. Items marked **✓ shipped** are in the repo today.
Items marked **→ tracked on ...** are addressed on a named branch or open PR.
Everything else is an open ask.

Every item below is tied to a specific pain observed during the session, not
speculation. The point of the document is to turn "this feels wrong" into a
concrete, fixable list so the server earns an agent's trust.

---

## 1. Consistency and correctness bugs (highest priority)

These aren't feature requests — they're observed incidents where the server
returned information that contradicted ground truth. Fix these first; nothing
else matters if an agent can't trust the tool's output.

### 1.1 `agda_load` and `agda_typecheck` disagreed on the same file — **✓ shipped (#39)**

Observed on a module with stacked errors: `agda_load` reported `type-error`
with a first-error line well past the real failure point; `agda_typecheck`
reported `ok-complete` with no errors; the command-line compiler reported a
different, still-earlier first-error line. All three disagreed on the same
file, same content, same toolchain.

**Ask:** `agda_load` and `agda_typecheck` MUST share one authoritative view of
session state (single `AgdaSession` instance, single `currentFile`/mtime,
single interaction with `_build/`). They should return bit-identical
`success`, `classification`, and `errors` for the same file.

**Status:** fixed in this release (issue #39). `agda_typecheck` now routes
through the shared singleton `AgdaSession`, the footgun `typeCheckBatch`
helper has been moved out of the production API surface, and `agda_load`
response envelopes include `previousClassification` / `previousLoadedAtMs` on
reloads plus a `session-regression` info diagnostic when a reload drops from a
previously successful classification into a failed load.

### 1.2 `agda_metas` returned errors from a *different* loaded file

After `agda_load File.agda` reported `classification: ok-complete,
goalCount: 0`, a follow-up `agda_metas` returned a well-formatted error
sourced from a transitive dependency of `File.agda`. The load call claimed
clean; the metas call revealed otherwise.

**Ask:** either the load call surfaces transitive-dependency errors by
default (an agent cannot proceed if a dep is broken, so pretending otherwise
wastes tokens and time), or `agda_metas` explicitly tags each diagnostic with
its owning file and separates "metas in the loaded file" from "diagnostics
accrued from dependencies". Today an agent has to assume any error anywhere
invalidates the load.

### 1.3 Query tools returned the previous typecheck error instead of an answer

A query tool was invoked on a name while a file with an unrelated error was
loaded. The response body echoed the type error verbatim as the value of the
query's `explanation` field, with no indication that the tool had been unable
to compute a real answer — the error was stuffed into a success-shaped
payload.

**Ask:** when a query-style tool (`agda_why_in_scope`, `agda_infer`,
`agda_compute`, `agda_search_about`, `agda_show_module`, ...) cannot compute
its result because the session is in an error state, the response should be a
structured `unavailable` classification with the blocking error, not the error
embedded in a happy-path payload.

### 1.4 `ok-complete` classification despite holes in the source

`agda_load` returned `classification: ok-complete, hasHoles: false,
goalCount: 0` on a file whose source contained multiple `{!!}` holes. Root
cause: an earlier scope-check failure aborted the load before it reached the
holes, so those holes were never registered as metas. Internally fine — but
the report needs to reflect "I never scope-checked past line N" rather than
"this file is complete".

**Ask:** when a load terminates early due to an error, include a
`lastCheckedLine` (or `scopeCheckReached`) field in the load response so
agents know how much of the file was actually seen. A `hasHoles: false` on an
aborted load is actively misleading.

---

## 2. Triage: help an agent pick what to load

The hardest part of working across a large Agda codebase isn't proving — it's
knowing *where to spend an interactive session*. Every `agda_load` costs tens
of seconds of stdlib bring-up. A 30-file survey is a full session of
wall-clock time before the agent writes a single edit.

### 2.1 Bulk typecheck with cascade deduplication

Multiple downstream files failing with the same `ClashingDefinition` all
rooted in a single redefinition upstream. Fixing that one root file would
have cleared all downstream failures in a single sweep.

**Ask:** `agda_bulk_status` takes a directory (or glob) and returns, per
file, its status plus a `root_cause_file` — the deepest dependency whose
fixing would unblock it. Output clusters failures by root cause. Secondary
ask: a `--parallel` mode, so a sequential 30-file sweep doesn't cost 40
minutes.

### 2.2 Pre-load error classifier

Of the mechanical failure classes an agent encounters across a large
codebase, the majority are import/rename drift (`ModuleDoesntExport` on
renamed stdlib names, `NotInScope` on operators that moved between modules,
missing fixity, parser regressions) and only a minority are genuine
proof-level problems (`UnequalTerms`, `UnsolvedMeta`, `NotStrictlyPositive`).
The mechanical class can be auto-repaired from a pattern catalog without an
interactive session.

**Ask:** `agda_triage_error` takes a compiler error and classifies it into
`{mechanical-import, mechanical-rename, parser-regression, coverage-missing,
proof-obligation, dep-failure, toolchain}` with a confidence score and a
machine-readable `suggested_action` (e.g.
`{action: "add_import", symbol: "proj₁", from: "Data.Product"}`). An agent
can then auto-batch all `mechanical-*` fixes in a single pass and reserve
interactive sessions for `proof-obligation`.

### 2.3 Dependency impact query

**Ask:** `agda_impact file.agda` → list of files that transitively import
it. Lets an agent pick "fix the file whose repair unblocks the most work"
instead of alphabetical order. Cheap to build from the existing module
resolver.

### 2.4 Pagination and filtering on `agda_list_modules`

`agda_list_modules` on a large subdirectory can return tens of kilobytes of
text and blow past an MCP client's token budget. A single listing tool
should never be the thing that forces an agent to fall back to shell `find`.

**Ask:** add `offset`, `limit`, and `pattern` parameters to
`agda_list_modules`. Default page size ~50.

---

## 3. Error-class-specific remediation

Mechanical patterns that show up repeatedly across survey-scale sessions.
Each corresponds to a specific tool that would turn a 5-minute diagnosis
into a 0-token automated fix.

### 3.1 `ClashingDefinition` → "who opened this name?"

Hit repeatedly: an `open` statement brings in a name that a later local
definition also binds. The compiler error names both definitions but doesn't
tell you which `open` is responsible when the offending module re-exports
from yet another module.

**Ask:** `agda_find_clash_source(symbol, file)` → structured response naming
both binding sites and the `open` statement responsible for bringing in the
conflicting name. Agent can then emit `hiding (symbol)` on the right `open`
without guessing.

### 3.2 `ModuleDoesntExport` → automated rename map

Stdlib version bumps and builtin reshuffles produce predictable rename
churn. Agda already prints a "did you mean ...?" suggestion in some cases,
but that string isn't surfaced in the MCP payload as structured data.

**Ask:**

- Parse the "did you mean" suggestion and expose it as
  `diagnostics[i].suggestedRename`.
- Ship a `stdlib_migration_map` resource keyed by
  `(from_version, to_version)` pairs covering the common stdlib transitions
  and the Agda builtin reshuffles between minor versions.
- `agda_apply_rename(file, from, to)` performs a scoped textual rename and
  re-checks the file, returning the diff.

### 3.3 `NotInScope` → symbol reverse-index

Top-level name referenced by one file but defined in another the caller
forgot to import.

**Ask:** `agda_suggest_import(symbol, file)` does a whole-repo reverse index
and returns candidate `open import` lines ranked by how many of the file's
existing imports already pull from each candidate module (i.e. the
smallest-possible-change ranking).

### 3.4 `CoverageIssue` → `agda_add_missing_clauses`

Emacs has this via `C-c C-c` on an unpatterned LHS. The MCP has
`agda_case_split` at the goal level but not at the function level.

**Ask:** `agda_add_missing_clauses(file, function_name)` consumes a compiler
`CoverageIssue` and emits stub clauses with `?` goals, which the agent can
then fill via the normal interactive workflow.

### 3.5 Builtin-existence probe

A file failed with a "FileNotFound" on a builtin that was moved between Agda
versions (e.g. something that lived under `Agda.Builtin.*` in one release
and moved to `Data.*` in a later one).

**Ask:** `agda_verify_builtin(name, options)` that, given a builtin name and
the effective option set, returns whether it's resolvable — cheaper than a
full load. Also ship a curated list of "renamed/removed builtins per Agda
version" as a static resource so agents can pattern-match common migrations
without loading.

### 3.6 Fixity-inference diagnostic

A user-defined `_≤ℕ_` without a fixity declaration can bind tighter than
stdlib's `_+_` (the default precedence 20 vs. `_+_`'s precedence 6), causing
an expression like `m ≤ℕ m + n` to parse as `(m ≤ℕ m) + n`. That then tries
to feed a `Set` into `_+_`, which Agda surfaces as the wildly misleading
"`Nat` should be a sort, but it isn't" — an error message that gives no hint
at the actual fixity root cause. Today, root-causing one of these means
writing a minimal probe file by hand.

**Ask:** `agda_infer_fixity_conflicts(file)` inspects every user-defined
operator lacking a fixity declaration and warns when it interacts with
imported operators whose precedence is numerically lower. Bonus: offer a
one-line auto-patch (`infix 4 _≤ℕ_`).

### 3.7 `--safe` flag introspection

Options affecting whether a file compiles can come from the file's `OPTIONS`
pragma, from an `.agda-lib` flag, from a wrapper script hard-coding
something on the command line, or from the MCP server's own default. Trying
to reason about why a file fails while the effective option set is opaque
is a guessing game.

**Ask:** `agda_effective_options(file)` returns the computed option set,
with each option tagged by source (`file pragma`, `agda-lib flags`, `wrapper
script`, `MCP default`). An agent trying to reason about why a file fails
needs this.

---

## 4. Interactive proof tooling gaps

### 4.1 `agda_term_search` should include module-level definitions

When a goal is provable by applying helpers defined a few lines up in the
same file, `agda_term_search` currently returns "No exact type matches found
in context" — it only considers the local hypothesis list.

**Ask:** `agda_term_search` takes an optional `scope: local | module |
imported` parameter and defaults to `module` (current file plus
re-exports). Paginate the results; expose a "cheapest chain of ≤ N
applications" mode.

### 4.2 `agda_auto` should be configurable

`agda_auto` returned "No automatic solution found" on a goal that required
one application of a module-level helper. Agda's underlying `auto` tactic
has depth/mode flags; the MCP tool exposes none.

**Ask:** expose `depth`, `listCandidates`, `excludeHints`, and `hints`
parameters. Let an agent say "try auto with depth 5 and `+helper-module`"
before giving up.

### 4.3 Goal renumbering after edits is opaque

Every time an agent edits-then-reloads, goal IDs can renumber. `agda_reload`
currently reports the post-reload state but doesn't *map* old IDs to new
IDs. An agent tracking a goal across a refactor has to re-identify it by
type.

**Ask:** `agda_reload` returns `{solved: [oldIds], new: [newIds],
renumbered: [{old, new}]}` with a best-effort stable identity based on the
declaration site, not the metavariable counter.

---

## 5. Cross-file analytics an agent actually needs

### 5.1 `agda_search_definitions` should support type-shape queries

Currently it matches on names. For proof work, the Hoogle-style "find me a
lemma with shape `_ ≤ _ + _`" query is more useful than a name search. Type
patterns can use metavariables (`_`) and need only unify up to the current
context, not full dependent equality.

**Ask:** `agda_search_definitions` accepts either a name pattern *or* a type
pattern.

### 5.2 Postulate reachability

`agda_check_postulates` tells you whether a file *contains* a postulate.
Also useful: "what postulates does this proof transitively depend on, via
the import graph?" — the number that actually matters for a correctness
argument.

**Ask:** `agda_postulate_closure(file, symbol)` walks dependencies and
returns the full set of postulates the named symbol's proof rests on,
grouped by subdirectory. Turns a correctness policy into a lint.

### 5.3 Project-wide progress reporting

Extend status tools to report, per subdirectory: total files, clean files,
files-with-holes, files-with-errors, files-with-postulates. "How is
`Directory/` doing overall?" without running N typechecks.

---

## 6. Toolchain and environment observability

### 6.1 Error-message placeholder rewriting

The compiler's own error formatter sometimes renders placeholder glyphs as
literal uppercase strings (e.g. `.AGDA` inside a sentence like "where
`.AGDA` denotes a legal extension for an Agda file"). This confuses agents
that grep-match paths.

**Ask:** post-process compiler error messages in the MCP layer to resolve
those placeholders to `<ext>` or the concrete list before returning.

### 6.2 Stale `.agdai` cache ambiguity

The session-state desync in §1.1 was consistent with one code path reading a
cached `.agdai` and another not. The server should either always trust the
cache or always bust it — and it should tell the agent which mode it's in.

**Ask:**

- `agda_cache_info(file)` returning cache hit/miss, mtime, and
  `source_hash == cached_hash`.
- A `forceRecompile: true` flag on `agda_load` as an opt-in escape hatch for
  when an agent suspects a stale cache.

### 6.3 Toolchain version in every response

`agda_show_version` exists as a dedicated tool. Stamping the Agda version
into every response's `provenance` field would save an agent from ever
re-asking.

**Ask:** include `agdaVersion` in the `provenance` block returned by every
tool. Cheap observability win.

---

## 7. Write-back for proof actions — **→ tracked on `feature/write-proof-actions-to-file`**

An agent following Emacs semantics expects `agda_give`, `agda_refine`,
`agda_case_split`, `agda_auto`, `agda_solve_one`, and `agda_solve_all` to
rewrite the source file. Today some of them only mutate the interactive
session's in-memory state; the agent has to round-trip through a separate
`Edit` call, and any missed `Edit` silently desynchronizes the server state
from disk state.

**Ask:** every proof-action tool should either (a) write back to disk by
default and return the exact diff that was applied, or (b) take an explicit
`persist: true|false` parameter, with `persist: true` being the recommended
default. Pair this with a blessed `agda_apply_edit(file, old, new)` that
performs the edit AND invalidates the server's interactive state AND
reloads, all in one call.

**Status:** tracked on the `feature/write-proof-actions-to-file` branch.
That branch ships persist-by-default `agda_give` / `agda_solve_*` /
`agda_case_split`, an `agda_apply_edit` round-trip primitive, and
auto-reload after edit, plus fixture tests for each.

---

## Priority ranking

If one afternoon of server work is available, spend it on:

1. **§1.x consistency** — partially addressed in this release for
   `agda_load` / `agda_typecheck` (#39); §1.2, §1.3, §1.4 remain open and
   are the highest correctness priority.
2. **§7 write-back for proof actions** — tracked on
   `feature/write-proof-actions-to-file`.
3. **§2.2 pre-load triage classifier** — biggest throughput win on a large
   codebase.
4. **§3.6 fixity-inference diagnostic** — high-surprise bug class, cheap to
   build.
5. **§4.1 module-wide `agda_term_search`** — turns the interactive loop
   from three round-trips to one on most applications.
6. **§2.1 / §2.3 bulk status + dependency impact** — makes a many-hundred
   module codebase actually navigable.

Everything after that is incremental.
