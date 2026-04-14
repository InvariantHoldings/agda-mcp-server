# Agda MCP Server v0.6.3 — Bug Report

**Server version:** `agda-mcp-server` 0.6.3
**Agda version:** 2.9.0
**Node.js version:** 24.14.0
**Session date:** 2026-04-01
**Status:** Bug 2 and Bug 3 are shipped. Bug 1 is still open; see below.

---

## Bug 1 — `agda_constraints` always fails (Agda 2.9.0 incompatibility)

**Fingerprint:** `a93379079bb7656e`
**Affected tool:** `agda_constraints`
**Classification:** `tool-error`
**Reproducibility:** 100% — every call, every file, every session (on Agda 2.9.0)
**Status:** **Open.** Not yet reproduced in CI (CI is on Agda 2.7.0.1),
still needs verification against a current-Agda build before a fix
lands.

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

### Fix direction

Determine the correct Agda 2.9.0 form of the constraints query (may need a
normalization mode argument, e.g. `Cmd_constraints Normalised`, or may have been
replaced by a different command in 2.9.0). Guard with the
`throwOnFatalProtocolStderr` catch path or suppress `cannot read:` for this
specific command and return an empty constraint list instead.

Current dispatch site: [src/agda/advanced-queries.ts `constraints()`](../../src/agda/advanced-queries.ts).

### Reproduction steps

1. Load any `.agda` file: `agda_load agda/Example/Module.agda`
2. Call `agda_constraints`
3. Observe: `tool-error` — "cannot read: IOTCM ... (Cmd_constraints)"

---
