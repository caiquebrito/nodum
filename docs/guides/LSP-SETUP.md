# LSP Setup — Neovim, Helix, Zed

`nodum-lsp` (spec 072) speaks standard [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
over stdio: `workspace/symbol`, hover, document symbols, code lenses, references, and inline
diagnostics for cycles/dead code/architecture violations — the same graph context the
[MCP integration](../../README.md#3-connect-claude) gives Claude, surfaced natively in any editor
that speaks LSP.

Using VS Code (or a fork — Cursor, Windsurf)? Install the
[Nodum extension](../../packages/vscode-extension/README.md) instead — it wraps the steps below
into a normal extension install, no manual config. A JetBrains plugin (IntelliJ, Android Studio,
PyCharm, GoLand, WebStorm) and a Visual Studio shim are planned but not yet available — see
[`docs/development/refined/073-per-ide-shims/spec.md`](../development/refined/073-per-ide-shims/spec.md).

## 1. Install `nodum-lsp`

Not published to npm yet (spec 072 ships it private/internal; a public release is tracked in the
roadmap). Build and link it from source:

```bash
git clone https://github.com/caiquebrito/nodum
cd nodum
npm install
npm run build
cd packages/lsp
npm install -g .
```

Verify it's on your `PATH`:

```bash
which nodum-lsp
```

## 2. Sync your project

`nodum-lsp` reads the same `~/.nodum/<project>/graph/graph.json` the CLI and MCP server use — sync
once before connecting an editor (a never-before-synced project also auto-syncs on first LSP
request, but that's a slower first response than doing it up front):

```bash
cd ~/my-project
nodum sync
```

## 3. Configure your editor

### Neovim (0.11+, built-in `vim.lsp`)

```lua
vim.lsp.config('nodum', {
  cmd = { 'nodum-lsp' },
  filetypes = { '*' }, -- nodum reasons over the whole project graph, not one language
  root_markers = { '.git' },
})
vim.lsp.enable('nodum')
```

Neovim 0.10 or earlier, via [`nvim-lspconfig`](https://github.com/neovim/nvim-lspconfig) — add a
custom server since `nodum-lsp` isn't in lspconfig's built-in registry yet:

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.nodum then
  configs.nodum = {
    default_config = {
      cmd = { 'nodum-lsp' },
      filetypes = { '*' },
      root_dir = lspconfig.util.root_pattern('.git'),
    },
  }
end
lspconfig.nodum.setup({})
```

### Helix

Add to `~/.config/helix/languages.toml` — Helix's config is per-`language-server`, referenced by
name from whichever `[[language]]` entries you want nodum active for (add the same
`language-servers` line to every language block in your project, or to `languages.toml`'s
`[language-server.nodum]` alone and reference it from each language you use):

```toml
[language-server.nodum]
command = "nodum-lsp"

[[language]]
name = "typescript" # repeat per language in your project — nodum reasons project-wide
language-servers = ["typescript-language-server", "nodum"]
```

### Zed

Zed's [`context_servers`/custom LSP support](https://zed.dev/docs/extensions/languages) currently
targets Zed extensions rather than a bare `settings.json` entry — this is the one recipe in this
guide not yet verified against a real Zed instance. Until a proper Zed extension exists, the most
direct path is Zed's generic external-server support, if your Zed version has it:

```json
{
  "lsp": {
    "nodum": {
      "binary": {
        "path": "nodum-lsp"
      }
    }
  }
}
```

If this doesn't pick up for your Zed version, please open an issue — Zed's extension API is the
more likely long-term path here, not a config snippet.

## Troubleshooting

- **No hover/diagnostics show up**: confirm `nodum sync` has run at least once
  (`nodum status` from the project root) and that your editor's LSP client log shows a successful
  `initialize` — most editors have an `:LspLog`/`LSP Logs` panel.
- **`nodum-lsp: command not found`**: `npm install -g .` didn't put it on `PATH` — check
  `npm config get prefix`'s `bin/` directory is in your shell's `PATH`.
- **Stale results after editing**: `nodum-lsp` re-syncs incrementally on file save. A large,
  unusual edit (renamed directories, moved files) may need a manual `nodum sync` to fully catch up.
