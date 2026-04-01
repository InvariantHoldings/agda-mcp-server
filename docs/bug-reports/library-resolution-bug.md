# Agda MCP Server — Library Resolution Bug

**Bug fingerprint:** `161e55de3ab9d121`
**Affected tool:** `agda_typecheck` / `agda_load`
**Agda command family:** `Cmd_load`
**Status:** Fixed upstream in `agda-mcp-server` v0.6.3 — downstream consumers now pin to that version.
**Enhancement tracked below:** [Stable `AGDA_DIR` support](#enhancement-stable-agda_dir-support)

---

## Summary

`agda_typecheck` and `agda_load` fail with a `[LibraryError]` when the project's
`.agda-lib` file uses an inline comment on the `name:` field — a construct that is
explicitly valid per the official Agda library documentation. The error manifested
because `EAN.agda-lib` names the library:

```
name: EAN -- Example Acronym Name
```

The inline comment `-- Example Acronym Name` is documentation, not part of the
library name. The official Agda package-system docs use the same convention in their
own examples.

---

## Error observed

```
error: [LibraryError]
Library 'EAN -- Example Acronym Name' not found.
Add the path to its .agda-lib file to
  '.cache/mcp/tmp/agda-mcp-libs-CkCA7n/libraries'
to install.
Installed libraries:
  standard-library-2.3
    (.cache/toolchains/stdlib/2.3/standard-library.agda-lib)
  EAN
    (EAN.agda-lib)
```

The contradiction is visible in the message itself: `EAN` **is** installed, but the
MCP server asked Agda for `EAN -- Example Acronym Name`. Agda strips inline
comments from `name:` fields, so it knew the library as `EAN` only.

---

## Root cause — MCP server v0.6.2

`parseAgdaLibraryName` in `agda-mcp-server` v0.6.2 returned the raw value of the
`name:` field without stripping the inline `--` comment. The function then passed
that raw string as the `-l` argument:

```sh
-l "EAN -- Example Acronym Name"   # v0.6.2 — WRONG
-l "EAN"                           # v0.6.3 — correct
```

Agda resolves `-l` by looking for a library whose `name:` field (after its own
comment-stripping) matches the argument. Because Agda strips inline comments but
the v0.6.2 MCP server did not, the name passed and the name stored diverged.

**This is a bug in the MCP server, not in `EAN.agda-lib`.** The `.agda-lib` file is
correctly authored per the Agda spec.

---

## Fix in v0.6.3

`parseAgdaLibraryName` now applies:

```js
const name = match[1].replace(/\s*--.*$/u, "").trim();
```

This strips the inline comment before the name is used anywhere, so `-l EAN` is
passed correctly.

---

## In-session reload limitation

The MCP server is a long-running Node.js process. Node.js caches imported ESM
modules at process startup; upgrading the package on disk during a session does not
affect the already-running process. In the session where this bug was diagnosed:

| Event                                         | Timestamp    |
| --------------------------------------------- | ------------ |
| MCP server process started (v0.6.2 loaded)    | 15:51:55     |
| `npm install agda-mcp-server@0.6.3` completed | 15:53:12     |
| `agda_typecheck` called (still fails)         | same session |

**A new session is required for v0.6.3 to take effect.** The fix is fully on disk
(`node_modules/agda-mcp-server@0.6.3`). Any session started after this PR is merged
will use the corrected code.

---

## Secondary fragility — temp `AGDA_DIR` and `env_register_libs`

Independent of the name-stripping bug, there is a fragility in how the MCP server
and the downstream launcher interact around `AGDA_DIR`.

`createLibraryRegistration` in the MCP server always creates a **fresh temp dir**
(`mkdtempSync`) as the `AGDA_DIR` passed to Agda. It writes only the project
library (`EAN`) to that temp dir's `libraries` file. The standard library is absent.

`EAN.agda-lib` declares `depend: standard-library-2.3`. For Agda to resolve that
dependency, `standard-library-2.3` must appear in `AGDA_DIR/libraries`. The
launcher wrapper `run-pinned-agda.sh` compensates by calling `env_register_libs`
before exec'ing Agda, which **overwrites** the temp dir's `libraries` file with both
stdlib and EAN entries.

This works, but it is fragile:

- The MCP server writes the file; the launcher wrapper overwrites it.
- If `AGDA_BIN` is set to a binary that does not call `env_register_libs` (e.g., the
  plain `tooling/scripts/run-pinned-agda.sh` fallback), `depend:` resolution fails.
- The overwrite silently discards any library entries the MCP server discovered
  that the wrapper does not know about.

---

## Enhancement — stable `AGDA_DIR` support

**Proposed by the `agda-mcp-server` author.**

Instead of always creating a random temp dir, the MCP server should accept a
configurable, persistent `AGDA_DIR`. When `process.env.AGDA_DIR` points to a
pre-populated stable cache (e.g., `.cache/agda/mcp-state`, already exported by
`run-agda-mcp.sh`), the server should use that directory directly as `agdaDir`
rather than creating a temp dir.

Benefits:

1. **`env_register_libs` pre-populates the stable dir** with both stdlib and EAN
   before the MCP server session starts. On session startup, `createLibraryRegistration`
   reads these as `configuredLibraries` — no wrapper overwrite needed.
2. **No race or overwrite:** both the MCP server and the launcher read/write the
   same file rather than the MCP server writing one temp path that the launcher
   immediately replaces.
3. **No cleanup:** the stable dir is owned by the repo cache, not a throwaway temp
   dir that requires a cleanup callback.
4. **Graceful fallback:** if `AGDA_DIR` is unset or points to an empty dir, fall back
   to the existing temp-dir behavior.

### Downstream changes required

When this enhancement lands in the MCP server, `run-agda-mcp.sh` already exports
`AGDA_DIR=.cache/agda/mcp-state`, so no launcher change is needed. The
`run-pinned-agda.sh` call to `env_register_libs` can remain as a belt-and-suspenders
guard, but it will no longer be the only thing that makes stdlib resolution work.

---

## Reproduction steps (v0.6.2)

1. Install `agda-mcp-server` v0.6.2.
2. Start the MCP server via `mcp/agda-launch/run-agda-mcp.sh`
   (`AGDA_BIN` resolves to `run-pinned-agda.sh`).
3. Call `agda_typecheck` with `file=agda/Example/Module.agda`.
4. Observe: `LibraryError: Library 'EAN -- Example Acronym Name' not found`;
   the installed libraries list correctly shows `EAN` and `standard-library-2.3`.

---

## Environment

| Field                     | Value                                             |
| ------------------------- | ------------------------------------------------- |
| `agda-mcp-server` running | `0.6.2` (loaded at process start)                 |
| `agda-mcp-server` on disk | `0.6.3` (installed during session)                |
| Agda version              | `2.9.0`                                           |
| Node.js version           | `24.14.0`                                         |
| `AGDA_BIN`                | `mcp/agda-launch/run-pinned-agda.sh`              |
| `AGDA_DIR` strategy       | temp dir (`mkdtempSync`), `TMPDIR=.cache/mcp/tmp` |
| Repo                      | Private                                           |
