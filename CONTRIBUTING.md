# Contributing

Thanks for contributing to `agda-mcp-server`.

## Development setup

This repository is standardized on Node 24.

### Prerequisites

- Node.js 24
- npm 11
- Agda on your `PATH`, or a pinned runner at `tooling/scripts/run-pinned-agda.sh`

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Test and verify

```bash
npm test
npm run verify
```

## Integration tests

The default test suite is intentionally lightweight and does not require a live
Agda installation.

To run the Agda-backed integration scaffold:

```bash
RUN_AGDA_INTEGRATION=1 npm run test:integration
```

If `agda` is not available, the integration test will fail. If the environment
variable is not set, the integration test is skipped.

## Project structure

- `src/agda/` contains the Agda transport layer and domain operations.
- `src/tools/` registers MCP-facing tools.
- `test/` contains unit tests and integration scaffolding.
- `dist/` contains compiled output.

## Coding guidelines

- Keep changes small and focused.
- Preserve the public API unless the change requires a documented breaking change.
- Prefer deterministic tests.
- Avoid introducing an Agda dependency into the default unit test path.
- Document new MCP tools in [README.md](README.md).

## Extensions

If you add extension-related functionality:

- keep the core server generic,
- prefer loading domain logic through extension modules,
- document extension environment variables and usage.

### Extension contribution workflow

1. Start from the catalog in `examples/extensions/`.
2. Add or update a focused sample when introducing a new extension pattern.
3. Update `docs/extensions.md` when extension contracts or conventions change.
4. Ensure examples remain covered by tests in `test/examples/`.
5. Keep extension tool names unique to avoid collisions with core tools.

### Extension quality gate

Before opening a pull request for extension-related changes, run:

```bash
npm run build
npm test
npm run test:examples
```

Optional live integration checks:

```bash
RUN_AGDA_INTEGRATION=1 npm run test:integration
RUN_AGDA_BACKEND_INTEGRATION=1 AGDA_BACKEND_EXPR=GHC npm run test:integration
```

## Release process

1. Update version metadata in [package.json](package.json).
2. Update [CHANGELOG.md](CHANGELOG.md).
3. Run `npm run verify`.
4. Create a tagged release and publish with npm.

## Pull requests

Before opening a pull request:

- make sure `npm run verify` passes,
- update docs for user-visible behavior,
- include tests when practical,
- describe any Agda-specific assumptions or environment requirements.
