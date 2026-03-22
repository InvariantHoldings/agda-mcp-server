# Security Policy

## Supported Versions

Security fixes are expected to be made against the latest published release.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead:

1. Open a private security advisory on GitHub, if available for the repository.
2. If that is not available, contact the maintainer through a private channel.
3. Include clear reproduction steps, impact, and any suggested mitigation.

You can expect a response acknowledging receipt as soon as practical, followed by
triage, validation, and a remediation plan if the report is confirmed.

## Scope

Relevant reports include issues such as:

- arbitrary command execution caused by the server,
- unsafe handling of filesystem paths,
- vulnerabilities in extension loading behavior,
- credential or environment variable leakage.

General Agda proof failures, type errors, or expected tool limitations are not
normally security issues unless they enable a broader exploit.
