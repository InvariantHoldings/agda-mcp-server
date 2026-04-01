# Security Policy

## Supported Versions

Security fixes are applied to the latest published release only.

| Version         | Supported |
|-----------------|-----------|
| Latest release  | ✅ Yes    |
| Older releases  | ❌ No     |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

1. Open a [private security advisory](https://github.com/InvariantHoldings/agda-mcp-server/security/advisories/new) on GitHub.
2. If that channel is unavailable, contact the maintainer through a private channel.
3. Include:
   - A clear description of the issue and affected component(s)
   - Reproduction steps (minimal example if possible)
   - Assessed impact and severity
   - Any suggested mitigation or patch

You can expect an acknowledgement as soon as practicable, followed by triage,
validation, and a remediation plan if the report is confirmed. We aim to release
a fix within 90 days of a confirmed critical or high-severity report.

## Scope

### In scope

The following classes of issue are in scope:

- **Path traversal** — a caller supplying a crafted `file` or `tier` argument
  that causes the server to read, write, or evaluate a file outside the
  configured project root (`AGDA_MCP_ROOT`).
- **Arbitrary command execution** — any input that causes the server to spawn
  an unintended subprocess or pass unsanitised data to the Agda process.
- **Extension loading abuse** — malicious use of the `AGDA_MCP_EXTENSION_MODULES`
  environment variable to load arbitrary code, if the variable can be influenced
  by an untrusted party in a realistic deployment.
- **Credential or secret leakage** — the server exposing environment variables,
  tokens, or other secrets through MCP tool output or error messages.
- **Dependency vulnerabilities** — a published dependency with a known CVE at
  high or critical severity that is reachable through normal server operation.
- **IOTCM injection** — a crafted expression or file path that causes
  unintended Agda protocol commands to be sent to the Agda process.

### Out of scope

- Agda type errors, proof failures, or expected tool limitations that do not
  enable a broader exploit.
- Issues that require local root access or control of the MCP client process
  to trigger (the server is a local stdio tool, not a network service).
- Theoretical vulnerabilities with no realistic attack path in this deployment
  model.

## Security Architecture

Key design properties relevant to security:

- **Stdio-only transport** — the server communicates exclusively over
  stdin/stdout; it does not open any network socket.
- **Path sandboxing** — all user-supplied file paths are resolved and validated
  to remain within the project root before any filesystem or Agda operation.
  For existing files and directories, the server additionally checks the
  canonical `realpath` target so symlinks inside the root cannot escape the
  sandbox. Paths that escape the root are rejected with an `invalid-path`
  error classification.
- **Subprocess isolation** — the Agda process is spawned via `child_process.spawn`
  with an explicit argument array (never `exec` or `shell: true`), eliminating
  shell-injection risk.
- **Input validation** — all MCP tool inputs are validated with Zod schemas
  before reaching any filesystem or subprocess operation.
- **Minimal dependency surface** — the runtime depends only on
  `@modelcontextprotocol/sdk` and `zod`. No network-facing middleware is used.
- **Pinned CI actions** — GitHub Actions workflows pin dependencies to
  immutable commit SHAs to guard against supply-chain substitution attacks.

## Dependency Auditing

The CI pipeline runs `npm audit --audit-level=high` on every push and pull
request. Any high or critical severity advisory will fail the build.

For local auditing:

```sh
npm audit
npm audit --audit-level=high   # exits non-zero on high/critical
```
