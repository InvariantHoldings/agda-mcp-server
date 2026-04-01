# Agda MCP Server v0.6.3 — Bug Report

**Server version:** `agda-mcp-server` 0.6.3
**Agda version:** 2.9.0
**Node.js version:** 24.14.0
**Session date:** 2026-04-01
**Status:** All bugs confirmed reproducible. Intended for upstreaming in a single
`agda-mcp-server` release.

---

## Bug 1 — `agda_constraints` always fails (Agda 2.9.0 incompatibility)

**Fingerprint:** `a93379079bb7656e`
**Affected tool:** `agda_constraints`
**Classification:** `tool-error`
**Reproducibility:** 100% — every call, every file, every session

### Observed

```
Error: cannot read: IOTCM "<file>" NonInteractive Direct (Cmd_constraints)
```

### Root cause

Agda 2.9.0 does not recognize `Cmd_constraints` (bare, no arguments) as a valid
IOTCM command. When sent this command, Agda 2.9.0 writes:

```
JSON> cannot read: IOTCM "..." NonInteractive Direct (Cmd_constraints)
```

to its **stdout** — a non-JSON line prefixed with `JSON>`. The MCP server's
`throwOnFatalProtocolStderr` function matches the `/^cannot read:/i` pattern in
non-JSON stdout lines and throws a fatal error.

This pattern also affects `Cmd_metas` **without** a normalization argument —
`Cmd_metas` (bare) produces the same `cannot read:` response. `Cmd_metas Normalised`
(the form the MCP server actually uses internally) works correctly.

### Diagnosis method

```bash
# Direct Agda 2.9.0 IOTCM probe:
# After Cmd_load, send:
IOTCM "file" NonInteractive Direct (Cmd_constraints)
# Agda 2.9.0 responds on stdout:
JSON> cannot read: IOTCM "file" NonInteractive Direct (Cmd_constraints)
```

### Fix direction

Determine the correct Agda 2.9.0 form of the constraints query (may need a
normalization mode argument, e.g. `Cmd_constraints Normalised`, or may have been
replaced by a different command in 2.9.0). Guard with the
`throwOnFatalProtocolStderr` catch path or suppress `cannot read:` for this
specific command and return an empty constraint list instead.

### Reproduction steps

1. Load any `.agda` file: `agda_load agda/Example/Module.agda`
2. Call `agda_constraints`
3. Observe: `tool-error` — "cannot read: IOTCM ... (Cmd_constraints)"

---

## Bug 2 — `agda_give` displays raw Agda protocol JSON as result

**Fingerprint:** `5dd5673b2c7c71db`
**Affected tool:** `agda_give`
**Classification:** display bug (tool succeeds, result is wrong)
**Reproducibility:** 100% — every successful `agda_give` call

### Observed

After giving `refl` to a trivial equality goal:

```
## Give `refl` to ?0

**Result:** `{"paren":false}`
```

The `data.text` and `summary` fields both contain the raw JSON-serialized
`GiveResult` object from Agda's IOTCM protocol.

### Root cause

Agda's `Cmd_give` response includes a `GiveResult` payload — either
`Give_Paren` or `Give_NoParen` — which serializes as `{"paren":true}` or
`{"paren":false}` in `--interaction-json` mode. The MCP server inserts this
object (via `JSON.stringify` or direct template interpolation) into the display
string rather than rendering it as a human-readable message.

`{"paren":false}` means "term accepted; no extra parentheses needed around it".
`{"paren":true}` means "term accepted; wrap it in parentheses".

### Fix direction

Render the `GiveResult` as a human-readable string:

```ts
const giveResultText = result.paren
  ? `Term accepted (parenthesized: \`(${expr})\`)`
  : `Term accepted: \`${expr}\``;
```

Or simply: `"Term accepted"` — the paren hint is of marginal value to an LLM agent.

### Reproduction steps

1. Load a file with holes: `agda_load agda/MCPTestHoles.agda`
2. Give a term to goal 0: `agda_give expr="refl" goalId=0`
3. Observe: summary contains `` Result: `{"paren":false}` ``

---

## Bug 3 — Concurrent tool calls corrupt stateful Agda session

**Fingerprint:** `a6965b9a6d2fe094`
**Affected tools:** All interactive tools (`agda_auto`, `agda_goal_type`,
`agda_context`, `agda_metas`, `agda_constraints`, `agda_goal_analysis`, etc.)
**Classification:** `process-error` (race condition)
**Reproducibility:** Triggered by parallel tool dispatch; consistent when ≥3
tools are called simultaneously

### Observed

When five tools are called in a single parallel batch after `agda_load`:

| Tool               | Result                                                  |
| ------------------ | ------------------------------------------------------- |
| `agda_infer`       | **succeeded**                                           |
| `agda_compute`     | **succeeded**                                           |
| `agda_auto`        | **failed** — "cannot read: IOTCM ... (Cmd_constraints)" |
| `agda_metas`       | **failed** — "cannot read: IOTCM ... (Cmd_constraints)" |
| `agda_constraints` | **failed** — "cannot read: IOTCM ... (Cmd_constraints)" |

After the parallel batch, sequential calls also misbehave:

- `agda_constraints` still fails (standalone bug, see Bug 1)
- `agda_goal_analysis` shows `(unknown)` for the goal type
- `agda_why_in_scope "refl"` returns unrelated module contents

All symptoms resolve after a fresh `agda_load`.

### Root cause

The underlying Agda process is a single-process IOTCM server: exactly one
command may be in-flight at a time. The MCP protocol allows a host to dispatch
multiple tool calls concurrently (e.g. an LLM agent sends 5 tool calls in one
response). Without an explicit serialization lock at the `AgdaSession` level,
concurrent `sendCommand` calls race for the process stdin/stdout:

- Multiple commands are written to stdin before any response arrives.
- Responses arrive interleaved; the first `sendCommand` to resolve its
  `Status`-terminated response window may consume lines belonging to a
  different command.
- The session's `currentFile`, `goalIds`, and `lastLoadedMtime` fields are
  updated by whichever command resolves last, potentially in the wrong order.

### Fix direction

Add a promise-based mutex (or `async-mutex`) around `AgdaSession.sendCommand`
so that concurrent tool calls are serialized at the session level before
anything is written to the process stdin. Example:

```ts
import { Mutex } from "async-mutex";
private readonly commandMutex = new Mutex();

sendCommand(command, timeoutMs) {
  return this.commandMutex.runExclusive(() =>
    this._sendCommandUnsafe(command, timeoutMs)
  );
}
```

This makes the session safe for the MCP host's concurrent dispatch pattern
while preserving the stateful nature of the Agda process.

### Reproduction steps

1. Load a file with holes: `agda_load agda/MCPTestHoles.agda`
2. In one parallel batch call: `agda_auto(goalId=0)`, `agda_metas`,
   `agda_infer(expr="refl", goalId=0)`, `agda_compute(expr="0+0", goalId=0)`,
   `agda_constraints`
3. Observe: `agda_auto`, `agda_metas`, `agda_constraints` all fail with the same
   "cannot read: Cmd_constraints" error — they consumed each other's responses
4. Call `agda_goal_analysis(goalId=1)` sequentially — observe `(unknown)` goal type
5. Call `agda_load` again — all state resets; subsequent calls succeed

---

## Summary table

| #   | Fingerprint        | Tool                  | Severity               | Agda protocol root                             |
| --- | ------------------ | --------------------- | ---------------------- | ---------------------------------------------- |
| 1   | `a93379079bb7656e` | `agda_constraints`    | Fatal — always fails   | `Cmd_constraints` not recognized by Agda 2.9.0 |
| 2   | `5dd5673b2c7c71db` | `agda_give`           | Minor — display only   | `GiveResult` JSON not rendered                 |
| 3   | `a6965b9a6d2fe094` | All interactive tools | High — data corruption | No command serialization mutex                 |

---

## Previously fixed (v0.6.3)

| Fingerprint        | Tool                           | Fix                                                                                       |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `161e55de3ab9d121` | `agda_typecheck` / `agda_load` | `parseAgdaLibraryName` now strips inline `--` comments before constructing `-l` arguments |

See `docs/bug-reports/library-resolution-bug.md` for details.
