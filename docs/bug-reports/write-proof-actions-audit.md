# Audit: `feature/write-proof-actions-to-file` branch

**Status:** working document. Written mid-review on PR #37 to capture
concrete improvements identified while waiting for the next Copilot review
round. The branch delivers §7 write-back and §4.3 goal-renumbering from
[agent-ux-observations.md](./agent-ux-observations.md); this document
catalogues latent bugs, edge cases, and test gaps that the implementation
should address before it merges.

Every item below is a real code observation, not speculation. Items are
grouped by severity. Severity reflects "will this break on a real user's
file" rather than code-smell intensity.

---

## 🔴 High — real bugs or reliability risks

### H1. TOCTOU between `existsSync` and `applyTextEdit` read

**Where:** [src/session/register-agda-apply-edit.ts:49](../../src/session/register-agda-apply-edit.ts)

Between `existsSync(resolvedPath)` and the `readFile` inside
`applyTextEdit`, the file can be deleted, replaced, or turned into a
directory. The callback would then throw `ENOENT` or `EISDIR` as an
unhandled promise rejection rather than returning a structured error.

**Fix:** Drop the `existsSync` probe. Catch `readFile` errors inside
`applyTextEdit` and surface them as `{applied: false, message}`.

### H2. `applyTextEdit` does not normalize CRLF in `oldText`

**Where:** [src/session/apply-proof-edit.ts:170](../../src/session/apply-proof-edit.ts)

LLM-generated `oldText` almost always uses `\n` line endings. If the
file uses CRLF, `source.indexOf(oldText)` returns `-1` for any multi-
line `oldText`, and the agent is told the text "is not found" even
though it is visibly present in the file.

**Fix:** Detect the file's dominant line ending
(`source.includes("\r\n")`) and, if CRLF, rewrite `oldText`'s bare
`\n` to `\r\n` before searching. Document the normalization in the
tool description so consumers know what to expect.

### H3. No mtime guard on `applyProofEdit` / `applyTextEdit` / `applyBatchHoleReplacements`

**Where:** [src/session/apply-proof-edit.ts](../../src/session/apply-proof-edit.ts)

All three functions read → compute edit → write. If the file changes
on disk between the read and the write (another agent, `git checkout`,
an external editor), we silently clobber the external change.
[`session.isFileStale()`](../../src/agda/session.ts) already tracks
`lastLoadedMtime`, but the edit functions never consult it.

**Fix:** In `applyEditAndReload` and `applyBatchEditAndReload`, call
`session.isFileStale()` before the edit. If stale, fail loud with a
message instructing the agent to run `agda_load` first. This matches
the existing `stalenessWarning` pattern in
[`tool-helpers.ts`](../../src/tools/tool-helpers.ts).

### H4. Inconsistent `replacementText` guards across proof-action tools

**Where:** [src/tools/goal-tools.ts](../../src/tools/goal-tools.ts)

Each proof-action tool does a different null-check:

| Tool | Guard |
|---|---|
| `agda_give` | `result.replacementText != null` |
| `agda_refine` | `typeof === "string" && length > 0` |
| `agda_refine_exact` | `result.replacementText != null` |
| `agda_intro` | `result.replacementText != null` |
| `agda_auto` | `result.solution` (truthy) |

If Agda returns an empty-string replacement (unlikely but possible),
the `!= null` variants would replace the hole marker with nothing,
corrupting the source. `agda_refine` is the only tool that gets this
right.

**Fix:** Factor a shared `hasReplacementText(t: string | null | undefined)`
helper and use it in all five proof-action tools. Apply the same
length-check to `agda_auto`'s `solution` field.

### H5. Unterminated hole scan runs to EOF without warning

**Where:** [src/session/goal-positions.ts:107](../../src/session/goal-positions.ts)

If a source ends with an unclosed `{!` (agent mid-edit, corrupt file,
file saved during a user keystroke), the scanner exits the inner loop
with `depth > 0` and pushes a `GoalPosition` whose `markerText` runs
to EOF. A follow-up `applyProofEdit` would then replace everything
from `{!` to EOF with the new expression — catastrophic data loss.

**Fix:** When the inner hole loop exits with `depth > 0`, discard the
position (or return it flagged `malformed: true`) and skip it in
`findGoalPosition`.

---

## 🟡 Medium — latent bugs, edge cases, unclear semantics

### M1. `isIdentChar` is surrogate-pair blind

**Where:** [src/session/goal-positions.ts:175](../../src/session/goal-positions.ts)

`ch.length === 1` returns `false` for astral-plane code points (e.g.
`𝟘`, `𝒇`, which are encoded as surrogate pairs in JS strings). Agda
identifiers legally contain astral characters, so a `?` preceded by
one would see the low surrogate as "not an ident char" and match as a
hole. Rare but real for math-heavy codebases that use bold digits or
blackboard letters.

**Fix:** Iterate by code points (`for..of` over the string) or use a
Unicode-aware regex (`/\p{L}/u`) for identifier detection.

### M2. `applyBatchHoleReplacements` silently keeps "first wins" on duplicates

**Where:** [src/session/apply-proof-edit.ts:76](../../src/session/apply-proof-edit.ts)

If `replacements` contains the same `goalId` twice, the first wins
and the later ones are silently dropped. This was a reviewer fix for
offset-corruption, but the dedup is lossy with no user-visible signal.

**Fix:** Track dropped duplicates and surface the count in the
`BatchApplyResult.message`. Alternatively: explicitly reject duplicates
with a clear error, since Agda never produces them and a duplicate in
`rawSolutions` is always a caller bug.

### M3. `applyBatchHoleReplacements` message hides discarded replacements

**Where:** [src/session/apply-proof-edit.ts:117](../../src/session/apply-proof-edit.ts)

Related to M2: when `replacements=[{id:0,a},{id:0,b},{id:0,c}]`, we
return `"Applied 1 solution(s) to file."` with no hint that 2 of 3
were discarded. Agents have no way to know whether Agda's output was
fully honoured.

**Fix:** Include `droppedDuplicates` count in `BatchApplyResult` and
the message.

### M4. `replace-line` semantics on multi-line `{! ... \n ... !}` holes

**Where:** [src/session/apply-proof-edit.ts:268](../../src/session/apply-proof-edit.ts)

If a hole spans multiple lines, `replace-line` replaces everything
from the start of the opening line to the end of the closing line.
Correct for single-line case-split holes (the common case), but
potentially surprising for multi-line holes. Agda never emits
`Cmd_make_case` on a multi-line hole so this is fine in practice.

**Fix:** Assert single-line hole in the branch or document the
behavior in the JSDoc.

### M5. `applyBatchHoleReplacements` does O(n·m) goalId lookups

**Where:** [src/session/apply-proof-edit.ts:79](../../src/session/apply-proof-edit.ts)

Uses `goalIds.indexOf(goalId)` inside a loop. For N goals and M
replacements, N·M operations. Trivial perf impact but symmetrically
wrong.

**Fix:** Build a `Map<number, number>` (goalId → index) once, reuse
in the loop.

### M6. Hole positions are recomputed on every single-edit call

**Where:** [src/session/apply-proof-edit.ts:247](../../src/session/apply-proof-edit.ts)

`applyProofEdit` calls `findGoalPosition` which scans the whole file
for every single proof action. A tool wrapper doing N sequential
single-goal edits rescans the file N times.

**Fix:** When we know we'll do multiple edits (e.g. the agent queues
several `agda_give` calls), the batch path already handles this. Not
worth fixing for single-edit paths unless a profile shows it mattering.

### M7. String-literal scan is duplicated inside the outer loop and inside the hole loop

**Where:** [src/session/goal-positions.ts:69, :133](../../src/session/goal-positions.ts)

The same string-literal loop (with escape handling and newline
tracking) appears twice, once in the top-level scanner and again
inside `{! ... !}` content scanning. A future fix to one (e.g. better
escape handling, raw strings) must be manually applied to both.

**Fix:** Factor `skipStringLiteral(source, i, lineState) → newI` and
call it from both places. Same for line comments and block comments.

### M8. `agda_apply_edit` string-compares paths for "is loaded file?"

**Where:** [src/session/register-agda-apply-edit.ts:57](../../src/session/register-agda-apply-edit.ts)

`session.currentFile === resolvedPath` is an exact string compare.
If one side is canonicalized via `realpath` and the other is not
(symlink, `..`, trailing slash), the comparison fails and we skip the
`goalIdsBefore` capture, losing the diff for what is actually the
currently loaded file.

**Fix:** Canonicalize both paths with `fs.realpathSync` before
comparing, or delegate to a shared path-equality helper.

### M9. `applyEditAndReload` returns `""` silently when `session.currentFile` is `null`

**Where:** [src/session/reload-and-diagnose.ts:63](../../src/session/reload-and-diagnose.ts)

If the proof-action tools are called with no file loaded (which their
`registerGoalTextTool` wrapper should prevent, but the defense-in-depth
check exists), `applyEditAndReload` silently returns an empty string.
The caller's output concatenation still works, but the agent has no
indication that the auto-apply path was skipped.

**Fix:** Return a structured warning message instead of `""`.

---

## 🟢 Low — polish, cleanup, style

### L1. Redundant Zod type casts

**Where:** [src/tools/goal-tools.ts](../../src/tools/goal-tools.ts)

`expr as string`, `variable as string`, `goalId as number` throughout
the callbacks. Zod has already validated and narrowed the types —
these casts are noise.

### L2. Inconsistent error-message phrasing

"Apply the edit manually" vs "Apply the edits manually" vs "No
confirmed replacement text was returned by Agda" — cosmetic but
worth normalizing through a small helper set.

### L3. `goal-id-diff.test.ts` has no formatter test

`formatGoalIdDiff` is internal to
[reload-and-diagnose.ts](../../src/session/reload-and-diagnose.ts)
but is on every reload's display path. We test `diffGoalIds` but not
the formatter that agents actually read.

### L4. Field name mismatch: `introduced` vs "new"

**Where:** [src/session/reload-and-diagnose.ts](../../src/session/reload-and-diagnose.ts)

`GoalIdDiff.introduced` is labelled `new` in the rendered output
(`Goal diff: solved ?X; new ?Y.`). The internal type uses `introduced`
because `new` is a reserved word. Either document the mapping or
surface `new: [...]` only in the formatted string and keep the JSDoc
explicit about it.

---

## 🔵 Tests to tighten

### T1. No test for `applyTextEdit` with CRLF file + LF `oldText`
Covers H2. Should verify that after the fix, the agent can pass
`\n`-delimited `oldText` and have it match a CRLF file.

### T2. No test for `findGoalPositions` on unterminated `{!` at EOF
Covers H5. Minimal test: `findGoalPositions("test = {! unclosed")`
should return `[]` or a flagged-malformed position, not a valid hole
running to EOF.

### T3. No test for astral-character adjacency to `?` holes
Covers M1. Test: `findGoalPositions("𝟘?")` — currently probably
matches, which is a subtle bug.

### T4. No test for `applyBatchHoleReplacements` with duplicate goalIds
Covers M2/M3. Verify the stated semantics ("first wins") are
actually what happens, and the message reports the discard count.

### T5. No test for `applyProofEdit` when file changed on disk
Covers H3. Write fixture → load session → externally modify file →
call `applyProofEdit` → expect staleness error.

### T6. No Agda type-check assertion for `.expected.agda` fixtures
The `WriteGiveSimple.expected.agda`, `WriteCaseSplit.expected.agda`,
etc. fixtures were proven to type-check by hand during development
but no CI assertion. Add an integration test that loads each
`.expected.agda` through a live `AgdaSession` and asserts
`goalCount === 0` and `classification === "ok-complete"`.

### T7. No test for `applyTextEdit` rejecting a directory path
Minor. Covers the EISDIR edge case once H1 is fixed.

### T8. No test for `formatGoalIdDiff`
Covers L3.

### T9. No test for `applyProofEdit` with a multi-line `{! ... \n !}` hole using `replace-line`
Covers M4. Document via test what the behavior is.

### T10. No test for `applyEditAndReload` when `session.currentFile === null`
Covers M9. The defensive empty-string return should be visible in
the test matrix.

---

## Priority ranking (if revisited after merge)

For one afternoon of post-merge work, in order of user impact:

1. **H2** — CRLF `oldText` normalization. Every agent that uses
   `agda_apply_edit` on a CRLF file today will hit "not found" on
   multi-line edits.
2. **H3** — mtime staleness guard. Prevents silent clobbering of
   external changes.
3. **H1, H4, H5** — cheap bug fixes; wrap them into a single commit.
4. **M2/M3** — explicit duplicate handling in the batch path.
5. **T1–T6** — test the fixes so they stay fixed.
6. **M1** — astral-character support in `isIdentChar`.
7. **L5 (factor scanners), M7** — maintenance hygiene.

Everything else is incremental polish.
