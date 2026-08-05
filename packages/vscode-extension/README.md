# Nodum for VS Code

Knowledge-graph context from [`nodum-lsp`](../lsp) directly in the editor: hover cards, workspace
symbol search, code lenses ("N dependents · complexity X"), cross-file references, and inline
diagnostics for circular imports, dead code, and (opt-in) architecture violations — the same
graph context [nodum gives Claude](../../README.md) over MCP, surfaced natively via the Language
Server Protocol.

Also works in VS Code forks that support the same extension format (Cursor, Windsurf).

## Requirements

`nodum-lsp` isn't published to npm yet — build and link it from source first. Full instructions:
[`docs/guides/LSP-SETUP.md`](../../docs/guides/LSP-SETUP.md#1-install-nodum-lsp).

```bash
git clone https://github.com/caiquebrito/nodum
cd nodum && npm install && npm run build
cd packages/lsp && npm install -g .
```

Then sync your project once before opening it (a never-before-synced project also auto-syncs on
first request, just slower for that first response):

```bash
cd ~/my-project
nodum sync
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `nodum.serverPath` | `""` (resolve `nodum-lsp` from `PATH`) | Absolute path to `nodum-lsp`, if it's not on `PATH`. |
| `nodum.trace.server` | `"off"` | `"messages"` or `"verbose"` to log LSP traffic to the "Nodum Language Server" output channel. |

## Commands

- **Nodum: Sync Project** (`nodum.sync`) — incremental re-sync + diagnostics refresh.
- **Nodum: Find Dead Code** (`nodum.deadCode`) — list unreachable files.
- **Nodum: Restart Language Server** (`nodum.restartServer`).

## Status

Early — this extension wraps `nodum-lsp` (spec 072) with no logic of its own beyond connecting
the standard `vscode-languageclient` to it (spec 073). Built and type-checked, verified against
real module-resolution/packaging behavior, but not yet installed and click-tested inside a real
running VS Code instance — see `docs/development/completed/073-per-ide-shims/spec.md` for exactly
what was and wasn't verified.
