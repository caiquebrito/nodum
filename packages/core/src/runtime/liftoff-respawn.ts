import { spawnSync } from 'node:child_process';

/**
 * Works around a real V8 bug (confirmed via a real ~21,447-file project,
 * spec 060): on Node `v25.9.0`, compiling a tree-sitter grammar's WASM
 * module with V8's optimizing (Turboshaft) compiler crashes the whole
 * process with `Fatal process out of memory: Zone` — a compiler-internal
 * allocator, unrelated to the JS heap or to anything this codebase does.
 * `--liftoff-only` (baseline-compiler-only WASM) avoids it entirely; a real
 * sync of that same project completed in ~12 minutes with it set, vs.
 * crashing in ~3 seconds without it.
 *
 * Neither `NODE_OPTIONS` (Node's flag allowlist rejects `--liftoff-only`)
 * nor `v8.setFlagsFromString()` at runtime (WASM tiering is decided too
 * early for a runtime flip) can apply this flag — verified directly, both
 * still crash. A real process argument, set before V8 initializes, is the
 * only mechanism that works — hence the self-respawn.
 *
 * Shared here (not in `packages/cli`) because both the CLI's `bin/nodum.ts`
 * and the MCP server's `index.ts` call `syncProject`, which parses with the
 * same grammar WASM and hits the same crash — `packages/mcp` depends on
 * `packages/core`, not on `packages/cli`, so this can't live there.
 */
export function ensureLiftoffOnly(): void {
  if (process.execArgv.includes('--liftoff-only')) return;

  const result = spawnSync(
    process.execPath,
    ['--liftoff-only', ...process.execArgv, process.argv[1] as string, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}
