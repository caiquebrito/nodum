# 002 — Consolidate the sync pipeline

## Status: done (2026-07-27) — verified via `npm run build`, `npm test --workspaces` (core 5/5, cli 2/2, mcp 4/4), and a real `nodum sync` against `benchmarks/projects/sample-next-app` confirming `clusters`/`nodeToCluster` are now present via every sync path

## Goal

There is currently **one** canonical sync orchestration, implemented **three times**, already disagreeing with itself. Consolidate into a single implementation in `packages/core`, parameterized for progress reporting and post-processing, with `packages/cli` and `packages/mcp` reduced to thin callers.

## Why now

This is a prerequisite for incremental sync (spec 003/004) — that work has to touch "the sync pipeline," and there currently isn't one, there are three, and they've drifted:

| | `core/src/sync.ts` `syncProject()` | `cli/src/commands/sync.ts` `syncProject()` | `mcp/src/handlers.ts` `handleSync()` |
|---|---|---|---|
| Discovers files, parses, writes graph.json | ✅ | ✅ | calls core's, then **rewrites graph.json again** |
| Runs `buildClusters` | ❌ never | ✅ | ✅ (duplicated call, own copy of the merge logic) |
| Progress bars | ❌ | ✅ (`makeProgressBar`/`runStep`) | ❌ |
| Generates embeddings | ❌ | ❌ | ✅ (only caller that does) |
| Error handling | throws raw | wraps in `new Error(...)`, **drops original stack** (`cli/.../sync.ts:99`) | try/catch, returns `{error}` |
| `projects.json` entry shape | inline `any`, duplicated verbatim in both `core` and `cli` | — | reads it back as `any` too |

Concretely, this means: a project synced via the CLI gets clusters but no embeddings; the same project synced via `core.syncProject()` directly (nothing currently calls this path other than the two callers above, but it's the public library entry point per `packages/core/src/index.ts:2-3`) gets neither; a project synced via the MCP `sync_project` tool re-parses nothing extra but does an unnecessary second `graph.json` read+write to bolt on clustering + embeddings that `cli`'s version already computed inline. Three copies of `updateProjectIndex` (one in `core`, one in `cli`) exist byte-for-byte identical except for import style — a change to the `projects.json` shape has to be made twice today and nothing enforces they stay in sync.

## Scope

- `packages/core/src/sync.ts` — becomes the single implementation: discovery → parse → analyze → **cluster (always)** → write `graph/graph.json`, `memory/SUMMARY.md`, `logs/activity.md`, `<project>/CLAUDE.md`, `projects.json`. Accepts an optional `hooks` object for progress callbacks. Returns the final `Graph` (already written to disk) so callers can post-process without a redundant read.
- New: `writeGraphFile(nodumDataDir, projectName, graph)` exported from core — the one place that knows the `graph/graph.json` path, for callers (MCP) that need to persist a mutation (e.g. embeddings) after `syncProject` returns.
- New: `ProjectIndexEntry` type in `packages/core/src/types.ts`, exported from `index.ts`, replacing the `any`-typed inline object literal duplicated in `core` and `cli`, and the `any`-typed read-back in `bin/nodum.ts` and `mcp/handlers.ts`.
- `packages/cli/src/commands/sync.ts` — becomes a thin wrapper: build progress-bar hooks, call `core.syncProject(...)`, print the summary from the returned `Graph`. Its own `updateProjectIndex` is deleted.
- `packages/mcp/src/handlers.ts` `handleSync` — calls `core.syncProject(...)` once, gets the graph back directly (no `loadProjectIndex()` + re-read of `graph.json` to find what it just wrote), generates embeddings on the returned graph, persists via `writeGraphFile`. Its own duplicate `buildClusters` call is deleted (clustering now happens once, inside `core.syncProject`).
- Error handling: replace the CLI's `throw new Error(\`Failed to sync project: ${...}\`)` with `throw new Error(..., { cause: error })` so the original stack survives (Node's standard `Error.cause`, supported since Node 16.9 — matches the repo's `engines.node >= 16` floor... actually cause requires 16.9+; confirm during implementation and fall back to attaching `.cause` manually if the installed `@types/node` typing doesn't have it).

## Out of scope

- Any incremental/partial sync behavior — this spec keeps the full-resync behavior identical, just deduplicated. Incremental sync is spec 004, built on top of this.
- Changing what clustering or embeddings compute — only where/how often they're invoked.
- `nodum status` (`bin/nodum.ts`) beyond typing its `projects.json` read with the new `ProjectIndexEntry` type instead of `any`.

## Design

**`packages/core/src/types.ts`** — add:

```ts
export interface ProjectIndexEntry {
  name: string;
  path: string;
  lastSync: string; // ISO timestamp
  stats: Graph['stats'];
  stack: { languages: string[]; frameworks: string[] };
}
```

**`packages/core/src/sync.ts`** — new signature:

```ts
export interface SyncHooks {
  onParseProgress?: (processed: number, total: number) => void;
  onClusterProgress?: (processed: number, total: number) => void;
  onStep?: (label: string) => void; // fired before each atomic step (analyze, write, etc.)
}

export async function syncProject(
  projectPath: string,
  nodumDataDir: string,
  hooks: SyncHooks = {},
): Promise<Graph> {
  // 1. resolve + validate path (unchanged)
  // 2. generateGraph(absolutePath, hooks.onParseProgress)
  // 3. analyzeProject(absolutePath)                          — hooks.onStep?.('Detecting stack')
  // 4. mkdir graph/memory/logs                                 (unchanged)
  // 5. buildClusters(graph.nodes, graph.edges, hooks.onClusterProgress)  — moved here, unconditional
  // 6. merge clusters into graph, write graph.json ONCE (not twice, unlike current cli/sync.ts)
  // 7. buildAndWriteSummary / appendActivityLog / injectCLAUDEContext    — hooks.onStep?.() around each
  // 8. updateProjectIndex(nodumDataDir, graph, analysis)  — single implementation, typed with ProjectIndexEntry
  // returns graph (with clusters + nodeToCluster attached)
}

export async function writeGraphFile(
  nodumDataDir: string,
  projectName: string,
  graph: Graph,
): Promise<void>;
```

`updateProjectIndex` keeps its current logic (read-merge-write `projects.json`) but is typed with `ProjectIndexEntry` and exists in exactly one place.

**`packages/cli/src/commands/sync.ts`** — shrinks to:

```ts
export async function syncProject(projectPath: string, nodumDataDir: string): Promise<void> {
  console.log(`📊 Scanning: ${resolve(projectPath)}`);
  const parseBar = makeProgressBar('Parsing code');
  const clusterBar = makeProgressBar('Generating clusters');
  let sawCluster = false;

  const graph = await coreSyncProject(projectPath, nodumDataDir, {
    onParseProgress: (p, t) => parseBar.update(p, t),
    onClusterProgress: (p, t) => { sawCluster = true; clusterBar.update(p, t); },
    onStep: (label) => runStepLabel(label), // thin console.log-based step announcer, replaces per-call runStep() wrapping
  });
  parseBar.done();
  if (sawCluster) clusterBar.done();

  console.log(`\n✅ Synced: ${graph.project}`);
  console.log(`  📁 ${graph.stats.files} files`);
  console.log(`  ⚙️  ${graph.stats.functions} functions`);
  console.log(`  📦 ${graph.stats.classes} classes`);
  console.log(`  🔗 ${graph.stats.edges} dependencies\n`);
}
```

The `try { ... } catch { throw new Error('Failed to sync project: ...', { cause: error }) }` wrapper stays at this layer (CLI is the right place to add a user-facing message), but now preserves `cause`.

**`packages/mcp/src/handlers.ts`** `handleSync`:

```ts
export async function handleSync(projectPath: string) {
  try {
    const graph = await syncProject(projectPath, NODUM_DATA_DIR); // core, already clustered
    await generateGraphEmbeddings(graph.nodes);
    await writeGraphFile(NODUM_DATA_DIR, graph.project, graph);
    globalConversationCache.clearProject(graph.project);
    const projects = await loadProjectIndex();
    const project = projects[graph.project];
    // ...unchanged response formatting below, using `graph` + `project` directly
  } catch (error) {
    return { error: String(error) };
  }
}
```

This removes the "sync, then guess the project name by popping the last key off `projects.json`" logic (`handlers.ts:96`, fragile under concurrent syncs) since the graph object already carries `graph.project`.

## Acceptance criteria

- [x] Only one function computes clusters during sync (`core.syncProject`); `cli` and `mcp` no longer call `buildClusters` directly.
- [x] Only one function writes `graph/graph.json` during a fresh sync (no double-write).
- [x] Only one `updateProjectIndex` implementation exists in the codebase, typed with `ProjectIndexEntry` (no `any`).
- [x] `mcp`'s `handleSync` no longer re-derives the project name via `Object.keys(projects).pop()`.
- [x] CLI sync output (console messages, progress bars) is unchanged from a user's perspective — this is a refactor, not a UX change.
- [x] `cli`'s sync error wrapper preserves the original error via `cause` (verify with a test that triggers a failure and asserts `error.cause` is the original error).
- [x] `nodum sync` against `benchmarks/projects/sample-next-app` produces a `graph.json` containing both `clusters` and `nodeToCluster` (previously only true via the CLI path — now true via any path, since core always clusters).
- [x] MCP `sync_project` tool result still contains embeddings (regression check — this must not be lost in the refactor).

## Test plan

New: `packages/core/src/sync.test.ts` — mock `fs/promises` and the graph-gen/analyzer/memory modules (`vi.mock`) to keep it fast and hermetic:
- `syncProject` calls `buildClusters` exactly once and the returned graph has `clusters`/`nodeToCluster` populated.
- `hooks.onParseProgress`/`onClusterProgress`/`onStep` are invoked when provided, and sync succeeds when hooks are omitted (all optional).
- `updateProjectIndex` merges into an existing `projects.json` rather than clobbering other projects (write a fixture with an unrelated existing project, assert it survives).
- Error path: a thrown error from `generateGraph` propagates with the project path preserved in the message.

Update `packages/cli/src/commands/sync.test.ts` (new) — mock `@caiquebrito/nodum-core`'s `syncProject`, assert the CLI wrapper prints the expected summary and that a thrown core error surfaces with `.cause` set.

## Success Metrics

- `grep -rn "buildClusters" packages/cli packages/mcp` returns nothing (only `packages/core` calls it during sync).
- `grep -rn "function updateProjectIndex" packages/` returns exactly one match.
- Full `npm run build && npm test --workspaces` passes.

## Related

Blocks: `003-file-change-detection`, `004-incremental-graph-generation` (both need one sync entry point to extend, not three).
