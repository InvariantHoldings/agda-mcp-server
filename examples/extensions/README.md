# Extension Examples Catalog

This folder contains runnable sample extension modules for agda-mcp-server.

## Files

| File                               | Language   | Demonstrates |
| ---------------------------------- | ---------- | ------------ |
| `ts-basic-extension.ts`            | TypeScript | Single `register` export with one diagnostic tool |
| `ts-multi-register-extension.ts`   | TypeScript | Multiple `register*` exports loaded from one module |
| `ts-goal-snapshot-extension.ts`    | TypeScript | Session-aware tool that inspects current goal contexts |
| `ts-policy-check-extension.ts`     | TypeScript | Repository policy check against source files |
| `js-basic-extension.js`            | JavaScript | Plain JS extension with JSDoc types |

## How to load one

Build your extension module first if needed, then set:

```bash
AGDA_MCP_ROOT=. AGDA_MCP_EXTENSION_MODULES=examples/extensions/ts-basic-extension.ts node dist/index.js
```

For multiple modules, separate entries with `:`.

```bash
AGDA_MCP_ROOT=. AGDA_MCP_EXTENSION_MODULES=examples/extensions/ts-basic-extension.ts:examples/extensions/js-basic-extension.js node dist/index.js
```

## Standalone setup for this examples folder

The examples folder includes its own `package.json` and `tsconfig.json` so it can
be type-checked and built independently.

```bash
cd examples/extensions
npm install
npm run check
npm run build
```

Built TypeScript files are emitted to `examples/extensions/dist`.

You can then load a compiled sample like:

```bash
AGDA_MCP_ROOT=. AGDA_MCP_EXTENSION_MODULES=examples/extensions/dist/ts-basic-extension.js node dist/index.js
```

## Notes

- Tool names in extensions must not collide with core server tools.
- Keep extension tools focused and deterministic.
- Use the shared `AgdaSession` for current loaded-file state and interactive goal IDs.
- See `docs/extensions.md` for the full extension contract and additional guidance.
