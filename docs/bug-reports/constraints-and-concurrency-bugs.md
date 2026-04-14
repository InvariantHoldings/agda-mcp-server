# Agda MCP Server v0.6.3 — Bug Report

**Server version:** `agda-mcp-server` 0.6.3
**Agda version:** 2.9.0
**Node.js version:** 24.14.0
**Session date:** 2026-04-01
**Status:** All three bugs are shipped. Kept here as historical record.

---

## ✓ Bug 1 shipped — `agda_constraints` on Agda 2.9.0 (`a93379079bb7656e`)

**Tools:** `agda_constraints`.

**Root cause (now confirmed against pinned 2.9.0):** Agda 2.9.0 added a
`Rewrite` mode argument to `Cmd_constraints`. The bare form
`Cmd_constraints` that worked through 2.8.0 is rejected with
`cannot read:` on 2.9.0+, while `Cmd_constraints Normalised` (and
`AsIs` / `Simplified` / `HeadNormal`) all return the structured
`{"info":{"constraints":[…],"kind":"Constraints"},"kind":"DisplayInfo"}`
response. Verified empirically against agda 2.8.0 (Homebrew) and
agda 2.9.0 (`.cache/agda/2.9.0/bin/agda`).

**Fix:**
[`buildConstraintsCommand`](../../src/agda/advanced-queries.ts) chooses
between the bare and rewrite-mode forms via
[`hasConstraintsRewriteMode`](../../src/agda/version-support.ts), gated
on Agda ≥ 2.9.0. When the version hasn't been detected yet, the newer
shape is the safe default. Unit coverage:
[`test/unit/agda/constraints-version-gating.test.ts`](../../test/unit/agda/constraints-version-gating.test.ts).
End-to-end coverage against the pinned 2.9.0 binary lives in
[`test/integration/agda/agda-constraints-2-9-0.test.ts`](../../test/integration/agda/agda-constraints-2-9-0.test.ts);
the test self-skips when `.cache/agda/2.9.0/bin/agda` isn't present.

A side note: `Cmd_metas Normalised` (the form the MCP server already
uses internally for metas, [`goal-operations.ts:198`](../../src/agda/goal-operations.ts))
keeps working on 2.9.0, so no change was needed there.

---
