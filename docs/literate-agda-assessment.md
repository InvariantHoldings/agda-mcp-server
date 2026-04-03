# Literate Agda Support Assessment

## Current State

The IOTCM protocol is format-agnostic: Agda handles all literate tangling
internally. This means most server tools already work with `.lagda`,
`.lagda.md`, `.lagda.rst`, and `.lagda.tex` files when paths are specified
explicitly. However, several gaps prevent a smooth literate Agda workflow.

### What Works

| Capability | Status |
|---|---|
| Loading `.lagda*` files via `agda_load` | Works — Agda detects format internally |
| Goal interaction (type, context, give, refine, case-split) | Works — IOTCM is format-agnostic |
| Proof search (`agda_auto`, `agda_solve_all`) | Works |
| Compilation via `agda_compile` with any backend | Works (untested with literate input) |
| Constraints, scope queries, elaboration | Works |

### What Does Not Work

| Capability | Issue |
|---|---|
| Module discovery (`agda_list_modules`) | Hardcoded `.agda` filter in `src/tools/file-tools.ts` |
| Definition search (`agda_search_definitions`) | Same hardcoded filter |
| Tool descriptions / schema hints | All say "Path to the .agda file" |
| Test coverage for literate formats | No `.lagda*` fixtures exist |
| Prose/code boundary awareness | Not implemented |

## Phased Recommendation

### Phase 1 — Patch Release (Low Effort, High Impact)

**Expand file extension matching** in `src/tools/file-tools.ts` to recognise
`.lagda`, `.lagda.md`, `.lagda.rst`, `.lagda.tex` alongside `.agda` in
directory enumeration. This unblocks `agda_list_modules` and
`agda_search_definitions` for literate projects.

**Fix tool descriptions** across all tools that reference ".agda file" in their
Zod schemas to say ".agda or literate .lagda* file" instead.

### Phase 2 — Minor Release (Medium Effort)

**Add literate test fixtures** to the fixture matrix
(`test/fixtures/agda/fixture-matrix.json`). At minimum, a `.lagda.md` fixture
that exercises goal interaction, case-split, and proof search through
interleaved prose and code blocks. Optionally add `.lagda.rst` and `.lagda.tex`
variants.

**Code-extraction mode for `agda_read_module`** that returns only the Agda code
blocks from a literate file, or annotates each line as code vs. prose. This
helps LLM clients focus on proof-relevant content.

### Phase 3 — Extension Modules (If Demand Warrants)

These capabilities are best delivered as optional extensions via the existing
`AGDA_MCP_EXTENSION_MODULES` system:

- **Literate file scaffolding** — generate well-formed `.lagda.md` skeletons
- **Prose/code boundary mapping** — show edits in literate context after goal
  operations
- **Document build pipelines** — pandoc/LaTeX rendering of literate output

## Rationale

The server's architecture requires no structural changes to support literate
Agda. The IOTCM protocol handles format detection transparently, so the gaps
are limited to file discovery, documentation, and test coverage. Phase 1 and 2
items are low-risk improvements that unlock literate workflows without expanding
the server's scope. Phase 3 items belong in the extension system to keep the
core server focused on interactive proof development.
