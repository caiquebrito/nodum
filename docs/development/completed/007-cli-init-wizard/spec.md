# 007 — `nodum init`: interactive project setup wizard

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (cli 22/22 incl. 7 new init.test.ts cases covering fresh-write, merge-preserving-other-servers, absolute-path resolution, and fallback), and two real checks against the actual environment: the non-TTY guard fails fast with the correct message and exit code in this genuinely non-interactive shell, and which node / which nodum-mcp resolve on this machine exactly as the mocked tests assume. Full interactive flow (prompts requires a real TTY) not exercised end-to-end beyond that — covered by unit tests instead.

## Goal

`nodum init [projectPath]` — a short interactive wizard that gets a project from zero to "synced and wired into Claude Code" in one command, instead of the current README-documented manual sequence: run `nodum sync`, then hand-edit (or `claude mcp add`) a `.mcp.json`, then remember to restart Claude Code.

## Why now

The README's own "Configure Claude Code" section (Quick Start step 3) is entirely manual today, including a documented troubleshooting case: Claude Code spawns the MCP server without the shell's full `PATH`, so a bare `"command": "nodum-mcp"` in `.mcp.json` can fail to resolve, and the fix is to manually run `which node && which nodum-mcp` and hand-write absolute paths instead. `nodum init` can just do that resolution itself and write a `.mcp.json` that works the first time.

## Scope

- `packages/cli/src/commands/init.ts` (new) — the wizard: confirm project path → offer to run the initial sync → offer to wire up `.mcp.json` (auto-resolving absolute paths for `node`/`nodum-mcp` the same way the README's troubleshooting section does by hand) → print next steps.
- `packages/cli/src/bin/nodum.ts` — new `nodum init [projectPath]` command.
- `packages/cli/package.json` — new `prompts` dependency (small, promise-based interactive prompts — no existing dependency in this repo does this).
- Non-interactive guard: if `process.stdin` isn't a TTY (piped input, CI), fail fast with a clear message pointing at `nodum sync` directly, instead of hanging on a prompt that can never be answered.

## Out of scope

- Include/exclude pattern configuration — that's `nodum config` (spec 005); `init` prints a one-line pointer to it as a follow-up step, doesn't duplicate its prompts.
- Windows path resolution — `which` (POSIX) only; on a `which` failure (including "the concept of `which` doesn't apply," e.g. Windows) the wizard falls back to the bare `"command": "nodum-mcp"` form and tells the user to consult the README's troubleshooting section if Claude Code can't find it. Flagging as a known gap, not fixing PATH resolution for every platform here.
- Detecting or offering to start `nodum watch` automatically — mentioned as a suggested next step in the final output, not launched.
- Re-running `nodum init` idempotently detecting "already initialized" state and changing its flow — it just asks the same questions again and merges into whatever `.mcp.json` already exists (see design below), which is safe to re-run but not specially aware that it's a re-run.

## Design

**`packages/cli/src/commands/init.ts`**:

```ts
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import prompts from 'prompts';
import { syncProject as coreSyncProject } from '@caiquebrito/nodum-core';

export async function initProject(projectPath: string, nodumDataDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'nodum init is interactive and requires a terminal. Run `nodum sync` directly in non-interactive contexts (CI, piped input).',
    );
  }

  const absolutePath = resolve(projectPath);
  console.log(`🚀 Setting up nodum for ${absolutePath}\n`);

  const answers = await prompts([
    { type: 'confirm', name: 'runSync', message: 'Run the initial sync now?', initial: true },
    { type: 'confirm', name: 'setupMcp', message: 'Set up Claude Code integration (.mcp.json)?', initial: true },
  ]);

  if (answers.runSync) {
    const graph = await coreSyncProject(absolutePath, nodumDataDir);
    console.log(`✅ Synced: ${graph.stats.files} files, ${graph.stats.functions} functions, ${graph.stats.classes} classes\n`);
  }

  if (answers.setupMcp) {
    await writeMcpConfig(absolutePath);
  }

  console.log('🎉 Setup complete!\n');
  console.log('Next steps:');
  if (answers.setupMcp) console.log('  • Restart Claude Code and run /mcp to confirm nodum is connected');
  console.log('  • nodum watch — keep the graph updated automatically as you edit');
  console.log('  • nodum config — customize include/exclude scan patterns');
}

function resolveBinary(name: string): string | null {
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

async function writeMcpConfig(projectPath: string): Promise<void> {
  const mcpPath = join(projectPath, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(await readFile(mcpPath, 'utf-8'));
  } catch {
    // No existing .mcp.json — start fresh.
  }
  config.mcpServers ??= {};

  const nodeBin = resolveBinary('node');
  const nodumMcpBin = resolveBinary('nodum-mcp');

  config.mcpServers.nodum = nodeBin && nodumMcpBin
    ? { command: nodeBin, args: [nodumMcpBin] }
    : { command: 'nodum-mcp' }; // fallback — matches README's Option B

  await writeFile(mcpPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`✅ Wrote ${mcpPath}${nodeBin && nodumMcpBin ? ' (with absolute paths)' : ' (bare command — nodum-mcp must be on PATH)'}`);
}
```

Merging into an existing `.mcp.json` (rather than overwriting) matters — a project may already have other MCP servers configured; `init` must only touch the `nodum` key under `mcpServers`.

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('init [projectPath]')
  .description('Interactive setup: sync + Claude Code integration')
  .action(async (projectPath: string | undefined) => {
    try {
      const nodumDataDir = getNodeumDataDir();
      const { initProject } = await import('../commands/init.js');
      await initProject(projectPath || process.cwd(), nodumDataDir);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
```

## Acceptance criteria

- [x] Running `nodum init` with `runSync: true` produces the exact same `graph.json`/`files.json`/etc. as running `nodum sync` directly (delegates to the same `core.syncProject`, no divergent logic).
- [x] `setupMcp: true` on a project with no existing `.mcp.json` creates one with the `nodum` server entry.
- [x] `setupMcp: true` on a project with an existing `.mcp.json` containing other servers preserves them, only adding/overwriting the `nodum` key.
- [x] When `which node`/`which nodum-mcp` both resolve, the written config uses absolute paths (`command`/`args` form) — not the bare `"command": "nodum-mcp"` form.
- [x] When resolution fails, falls back to the bare `"command": "nodum-mcp"` form without throwing.
- [x] Answering `no` to both prompts still completes successfully (no sync, no `.mcp.json` write) and prints next steps.
- [x] Running with `process.stdin.isTTY` false fails fast with a clear message instead of hanging.

## Test plan

`packages/cli/src/commands/init.test.ts` (new) — mock `prompts`, `@caiquebrito/nodum-core`'s `syncProject`, and `child_process.execSync`:
- `runSync: true` calls `coreSyncProject` with the resolved project path.
- `runSync: false` never calls `coreSyncProject`.
- `setupMcp: true` with no existing `.mcp.json` (mock `readFile` rejecting) writes a fresh one with the `nodum` entry.
- `setupMcp: true` with an existing `.mcp.json` containing `{ mcpServers: { other: {...} } }` writes back both `other` and `nodum`.
- `execSync` resolving both binaries → written config has `command`/`args` (absolute-path form).
- `execSync` throwing (binary not found) → written config falls back to `{ command: 'nodum-mcp' }`.
- Non-TTY (`process.stdin.isTTY = false`) rejects before ever calling `prompts`.

## Success Metrics

- Real check: `nodum init` on a scratch project, answering yes/yes — resulting `.mcp.json` has valid, absolute-path `command`/`args` matching this machine's actual `node`/`nodum-mcp` locations, and `graph.json` exists with correct stats.
- Real check: re-running against a project with a hand-written `.mcp.json` containing an unrelated MCP server — that server's entry survives untouched.

## Related

Independent of specs 003–006 — this is a UX/onboarding wrapper around existing `sync` (spec 002's `core.syncProject`), not new graph-generation logic.
