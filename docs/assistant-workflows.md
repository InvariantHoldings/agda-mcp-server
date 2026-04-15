# Assistant Workflows

This document describes the recommended patterns for using the `agda-mcp-server`
reporting and introspection tools when you are an AI assistant working on an
Agda codebase.

---

## 1. Discovery: what can this server do?

Before starting a proof session, call `agda_tools_catalog` to get a snapshot of
everything the server exposes: tool names, categories, Agda protocol commands
they map to, input/output schema field names, and the detected Agda version.

```
agda_tools_catalog {}
```

**What you get:**
- `serverVersion` — the running server build
- `agdaVersion` — the Agda binary's version string (or undefined if undetected)
- `supportedExtensions` — file extensions your Agda accepts (`.agda`, `.lagda.md`, …)
- `supportedFeatureFlags` — `--cubical`, `--erasure`, etc. available to your Agda
- `tools` — array of manifest entries: `{ name, description, category, protocolCommands, inputFields, outputFields }`

**Typical use:**
- Use `supportedExtensions` to decide whether to call `agda_load` on literate files.
- Filter `tools` by `category: "proof"` to enumerate the goal-management surface.
- Use `inputFields`/`outputFields` as a schema reference without reading source code.

---

## 2. Session introspection: what is happening right now?

Use `agda_session_snapshot` for a one-call view of the current session state.
This replaces the older pattern of calling `agda_session_status` + `agda_metas`
separately.

```
agda_session_snapshot {}
```

**What you get:**
- `loadedFile`, `projectRoot`, `phase`, `isStale`
- `goalCount`, `invisibleGoalCount`, `completeness`, `lastClassification`
- `lastLoadedAt`, `provenance` (server + Agda version stamps)
- `suggestedActions` — prioritised list of next tool calls

**Typical pattern:**
```
1. agda_session_snapshot → inspect phase / goalCount / completeness
2. if phase=idle and goalCount>0: agda_goal_catalog to see all goals at once
3. if isStale=true: agda_load to reload before issuing proof commands
4. if lastClassification=type-error: agda_apply_edit or fix source, then reload
```

---

## 3. Goal-level work: all goals in one call

Instead of looping with `agda_goal` per goal, use `agda_goal_catalog` to get the
full proof state in one round-trip.

```
agda_goal_catalog {}
```

**What you get:**
- `goals` — array of `{ goalId, type, context, splittableVariables, suggestedActions }`
- `summary`, `totalGoals`, `invisibleGoals`, `completeness`

**Typical pattern:**
```
1. agda_goal_catalog → identify all open goals and their types
2. For each goal with suggestedActions including "case_split": agda_case_split
3. For goals where context has a matching binder: agda_give / agda_refine
4. For goals with known terms: agda_auto or agda_solve_all
```

---

## 4. Recommendation-driven proof search

Use `agda_tool_recommend` when you are not sure what to do next. It reads the
full session state and returns the most likely next tool calls.

```
agda_tool_recommend {}
```

**What you get:**
- `recommendations` — ordered list of `{ tool, rationale, args, blockers, priority }`

**Typical pattern:**
```
agda_tool_recommend
→ highest priority: agda_load (session stale or never loaded)
→ or: agda_case_split goalId=2 (context has a splittable Nat variable)
→ or: agda_give goalId=0 expr="refl" (goal is an equality with matching sides)
```

---

## 5. Protocol capability awareness

Before issuing advanced or backend-gated commands, query the protocol parity
matrix to check whether the server has verified coverage for that command family.

```
agda_protocol_parity {}
```

**What you get:**
- `entries` — all Agda IOTCM commands with `parityStatus` and `coverageLevel`
- `knownGaps` — any commands with `parityStatus=known-gap`
- Summary counts: `endToEndCount`, `verifiedCount`, `mappedCount`, `knownGapCount`

**Parity status meanings:**
| Status | Meaning |
|---|---|
| `end-to-end` | Covered by unit + property + Agda-backed + MCP harness tests |
| `verified` | Covered by unit + Agda-backed tests |
| `mapped` | Wired in the server but not yet fully tested end-to-end |
| `known-gap` | Not yet implemented or intentionally unimplemented |

---

## 6. Filing a bug report

When you observe unexpected behavior, use `agda_bug_report_bundle` to produce a
structured bundle suitable for filing a GitHub issue.

```
agda_bug_report_bundle {
  "kind": "new-bug",
  "affectedTool": "agda_load",
  "classification": "process-error",
  "observed": "agda_load returns process-error for a file that compiles fine in the Agda REPL",
  "expected": "agda_load should return ok-complete",
  "reproduction": [
    "agda_load file=Broken.agda",
    "observe classification=process-error in response"
  ],
  "diagnostics": [
    { "severity": "error", "message": "cannot read: ...", "code": "process-error" }
  ],
  "agdaCommandFamily": "Cmd_load"
}
```

**What you get:**
- `bugFingerprint` — stable 16-char hex ID for deduplication
- `title` — auto-generated issue title
- Full structured bundle ready for GitHub

**For follow-up updates**, use `agda_bug_report_update_bundle` with the same
fingerprint and `existingIssue` number:

```
agda_bug_report_update_bundle {
  "existingIssue": 42,
  "affectedTool": "agda_load",
  "classification": "process-error",
  "observed": "...",
  "expected": "...",
  "reproduction": [...]
}
```

---

## 7. Typical full session pattern

```
# Step 1: Orient
agda_tools_catalog          → check Agda version + supported extensions
agda_session_snapshot       → any active session? stale?

# Step 2: Load
agda_load file="MyProof.agda"

# Step 3: Triage
agda_session_snapshot       → check classification + goalCount
agda_goal_catalog           → see all goals and types at once

# Step 4: Work goals
agda_tool_recommend         → let the server suggest a next action
agda_case_split / agda_give / agda_auto  per goal

# Step 5: If stuck
agda_protocol_parity        → check if the command family has known gaps
agda_bug_report_bundle      → file a structured report if the server misbehaves
```

---

## 8. Schema discovery without reading source

`agda_tools_catalog` returns `inputFields` and `outputFields` lists for every
tool. For full field types, use the `outputSchema` and `inputSchema` maps in the
structured response data (each field name maps to a type string like `"string"`,
`"number"`, `"boolean"`, `"array"`, `"object"`, `"optional:string"`, etc.).

This means you can build tool-use plans from the catalog alone, without reading
TypeScript source or consulting external documentation.
