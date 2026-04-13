# Audit: `feature/write-proof-actions-to-file` branch

**Status:** shipped. Written mid-review on PR #37 to capture concrete
improvements identified while waiting for the next Copilot review
round. The branch delivered §7 write-back and §4.3 goal-renumbering
from [agent-ux-observations.md](./agent-ux-observations.md), plus
the audit items listed here. See `git log` on the branch for
per-item commits.

Completed: H1–H5, M1–M5, M7–M9, L3, T1–T5, T7–T10. ✓

---

## Remaining follow-ups (post-merge)

Items deliberately not fixed in this PR, ordered by impact:

### T6. Live-Agda typecheck for `.expected.agda` fixtures

Run every `test/fixtures/agda/Write*.expected.agda` through a live
`AgdaSession` in the integration suite and assert
`goalCount === 0` and `classification === "ok-complete"`. Builds
confidence that the fixture vectors stay type-checkable as Agda
versions drift. Defers because it requires the integration harness,
which is a separate setup from the unit test layer this PR added.

### M6. Hole positions recomputed on every single-edit call

`applyProofEdit` calls `findGoalPosition` which scans the whole
file for every single proof action. N sequential single-goal edits
rescan the file N times. Trivial perf impact in practice (typical
files are <10k lines, scanner is ~O(n)), and the batch path is
already optimal for tools that do many edits at once. Fix only if
a profile shows it mattering.

### L1. Redundant Zod type casts in `goal-tools.ts`

`expr as string`, `variable as string`, etc. Zod has already
validated and narrowed the types — these casts are noise.
Removing them requires threading input types through
`registerGoalTextTool`, which is out of scope for this PR. Bundle
with the next touches to that file.

### L2. Inconsistent error-message phrasing

"Apply the edit manually" vs "Apply the edits manually" vs "No
confirmed replacement text was returned" — cosmetic. Normalize
through a small helper set when the next round of review comments
surfaces them.

### L4. `GoalIdDiff.introduced` field name vs "new" label

The internal field is `introduced` because `new` is a reserved
word in TS; the rendered output uses `new ?X` for the
agent-facing label. The JSDoc already explains the mapping.
Leaving as-is — renaming would be pure churn.
