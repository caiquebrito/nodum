# 004 — Incremental graph generation

## Status: done (2026-07-27) — verified via npm run build, npm test --workspaces (core 19/19 incl. 8 new file-discovery + 3 new graph-gen tests), and real end-to-end nodum sync --incremental against a scratch copy of sample-next-app: added-function case, deleted-file case (clean eviction, zero dangling edges), and no-prior-sync fallback case, all correct

## Goal

Make `nodum sync --incremental` actually skip re-reading and re-parsing files that haven't changed since the last sync, using the `graph/files.json` manifest spec 003 introduced. Full (non-incremental) sync stays byte-for-byte the same as today — this is purely an opt-in fast path.

## Why now

Roadmap's stated impact: "10-100x faster syncs for large projects (1000+ files)." Spec 003 built the manifest; this spec is what actually reads it back and uses it to skip work. Without this, `files.json` is just a diagnostic artifact nobody consumes.

## Scope

- `packages/core/src/file-discovery.ts` — new `discoverChangedFiles()` that, given a previous manifest, stat-checks every file first (cheap syscall, no content read) and only reads+hashes files whose `mtimeMs`/`size` changed. Shares the directory-walk/ignore-list logic with the existing `discoverFiles()` via an extracted helper (no duplicated `IGNORED_DIRS`/`SUPPORTED_EXTENSIONS` handling).
- `packages/core/src/graph-gen.ts` — `generateGraph()` gains an options object with `previousGraph`/`previousFiles`; when both are supplied, evicts nodes/edges belonging to changed-or-deleted files from the previous graph and re-parses only the changed set, instead of a full rescan.
- `packages/core/src/sync.ts` — `SyncHooks` gains `incremental?: boolean`. When set, loads the previous `graph.json`/`files.json` before calling `generateGraph`; if neither exists yet (first-ever sync), silently falls back to a full sync.
- `packages/cli/src/bin/nodum.ts` — `nodum sync --incremental` flag.

## Out of scope

- **Cross-file edge eviction correctness beyond today's reality.** Parsers currently emit zero cross-file edges — `imports` resolution doesn't exist yet (that's spec 010), so every edge's `source` and `target` always belong to the same file that emitted them. Eviction-by-file-membership is exactly correct *today* because of this. Once spec 010 adds real cross-file edges, this eviction logic will need revisiting (an edge could then survive with a dangling endpoint if only one of the two files it spans changed) — flagging now so it isn't a surprise later, not fixing it here.
- **Incremental clustering.** `buildClusters` still runs unconditionally over the full merged node/edge set on every sync, incremental or not. Clustering is comparatively cheap and stateless; partial re-clustering is a separate, much harder problem not worth solving alongside this.
- `nodum watch` (spec 006) — a different feature (auto-trigger on file change) that will *use* `--incremental` once it exists, but isn't part of this spec.
- Making `discoverFiles()` (the non-incremental path) any faster — intentionally unchanged, per spec 003's own scope note.

## Design

**`packages/core/src/file-discovery.ts`** — extract the shared walk, add the diff-aware variant:

```ts
export interface DiscoveryDiff {
  changed: FileInfo[];       // new or modified — full content read, ready to parse
  unchanged: FileManifest;   // confirmed-unchanged entries, ready to merge as-is
  deletedPaths: string[];    // present in the previous manifest, not found this walk
}

export async function discoverFiles(rootPath: string): Promise<FileInfo[]> {
  // unchanged from spec 003 — always reads + hashes every file
}

export async function discoverChangedFiles(
  rootPath: string,
  previousManifest: FileManifest,
): Promise<DiscoveryDiff> {
  const changed: FileInfo[] = [];
  const unchanged: FileManifest = {};
  const seenPaths = new Set<string>();

  await walkFiles(rootPath, rootPath, async (fullPath, relativePath, ext) => {
    seenPaths.add(relativePath);
    const stats = await stat(fullPath);
    const prev = previousManifest[relativePath];

    // Fast path: mtime + size match the last sync — trust it, skip the read entirely.
    if (prev && prev.mtimeMs === stats.mtimeMs && prev.size === stats.size) {
      unchanged[relativePath] = prev;
      return;
    }

    // Slow path: something differs — read + hash to find out if content actually changed.
    const content = await readFile(fullPath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    if (prev && prev.hash === hash) {
      // Touched but identical content (e.g. `touch`, re-save with no edits).
      // Not re-parsed, but refresh mtimeMs so the next sync gets the fast path again.
      unchanged[relativePath] = { hash, mtimeMs: stats.mtimeMs, size: stats.size };
      return;
    }

    changed.push({ path: relativePath, ext, content, hash, mtimeMs: stats.mtimeMs, size: stats.size });
  });

  const deletedPaths = Object.keys(previousManifest).filter(p => !seenPaths.has(p));
  return { changed, unchanged, deletedPaths };
}
```

`walkFiles` is the existing `walkDirectory` traversal (ignore-dir/extension-filter logic unchanged), refactored to take a per-file callback instead of pushing directly into a `FileInfo[]`, so both functions share it.

**`packages/core/src/graph-gen.ts`**:

```ts
export interface GenerateGraphOptions {
  onProgress?: (processed: number, total: number) => void;
  previousGraph?: Graph;
  previousFiles?: FileManifest;
}

export async function generateGraph(
  projectPath: string,
  options: GenerateGraphOptions = {},
): Promise<{ graph: Graph; files: FileManifest }> {
  const { onProgress, previousGraph, previousFiles } = options;
  if (previousGraph && previousFiles) {
    return generateGraphIncremental(projectPath, previousGraph, previousFiles, onProgress);
  }
  return generateGraphFull(projectPath, onProgress); // today's logic, extracted verbatim, unchanged
}
```

`generateGraphIncremental`:
1. `discoverChangedFiles(projectPath, previousFiles)`.
2. `removedPaths = deletedPaths ∪ changed[].path` — anything whose old nodes must be evicted before (re-)adding.
3. `survivingNodes = previousGraph.nodes.filter(n => !removedPaths.has(n.file))`; `survivingEdges` = previous edges where both `source` and `target` still exist in `survivingNodes` (this is also what silently drops any edge belonging to a removed file, since today edges never cross file boundaries — see Out of scope).
4. Seed `nodeMap`/`edgesSet` from the survivors, then run the **exact same per-file parse loop** as the full-scan path over `diff.changed` only, merging in.
5. `stats.files = Object.keys(diff.unchanged).length + diff.changed.length`; other stats recomputed from the final merged node set, same as today.
6. Returned `files` manifest = `{ ...diff.unchanged, ...changed-files'-manifest-entries }`.

**Reusing `previousGraph.nodes` objects wholesale for unchanged files is what already exists** — no new code needed to preserve `embedding` (set by the MCP server, spec-2.0) on unchanged nodes across an incremental CLI sync. `clusterId` gets overwritten regardless, since clustering always reruns fully in step 6 of `syncProject` (see Out of scope).

**`packages/core/src/sync.ts`**:

```ts
export interface SyncHooks {
  onParseProgress?: (processed: number, total: number) => void;
  onClusterProgress?: (processed: number, total: number) => void;
  onStep?: (label: string) => void;
  incremental?: boolean;
}

// inside syncProject, before generateGraph:
let previousGraph: Graph | undefined;
let previousFiles: FileManifest | undefined;
if (hooks.incremental) {
  try {
    const dir = graphDataDir(nodumDataDir, basename(absolutePath));
    previousGraph = JSON.parse(await readFile(`${dir}/graph/graph.json`, 'utf-8'));
    previousFiles = JSON.parse(await readFile(`${dir}/graph/files.json`, 'utf-8'));
  } catch {
    // No previous sync — nothing to diff against, fall back to a full sync.
  }
}

const { graph, files: fileManifest } = await generateGraph(absolutePath, {
  onProgress: hooks.onParseProgress,
  previousGraph,
  previousFiles,
});
```

**`packages/cli/src/bin/nodum.ts`**:

```ts
program
  .command('sync [projectPath]')
  .description('Scan and index a project, generate knowledge graph (defaults to current directory)')
  .option('--incremental', 'Only re-parse files changed since the last sync (falls back to full sync if none exists)')
  .action(async (projectPath: string | undefined, options: { incremental?: boolean }) => {
    // ... pass options.incremental through to the cli syncProject wrapper, which threads it
    // into coreSyncProject's hooks.incremental
  });
```

## Acceptance criteria

- [x] `discoverChangedFiles` does not call `readFile` for any path whose `mtimeMs`/`size` still match the manifest (verified by mocking `fs/promises` and asserting call counts).
- [x] A file touched (mtime changed) but with identical content is classified as `unchanged`, with its manifest entry's `mtimeMs` refreshed.
- [x] A genuinely modified file appears in `changed`; a new file appears in `changed`; a removed file appears in `deletedPaths`.
- [x] `generateGraph` with `previousGraph`/`previousFiles` supplied only re-parses `diff.changed`; nodes/edges for unchanged files come from `previousGraph` verbatim (same object identity acceptable, not required).
- [x] Deleting a file and running an incremental sync removes that file's nodes (and any edges that referenced them) from the resulting graph.
- [x] `stats.files` after an incremental sync equals the true current file count (unchanged + changed), matching what a full sync would report.
- [x] `syncProject({ incremental: true })` against a project with no prior `graph.json`/`files.json` completes a normal full sync without throwing.
- [x] `nodum sync --incremental` is wired end-to-end: CLI flag → `SyncHooks.incremental` → `generateGraph` options.
- [x] Non-incremental `nodum sync` (no flag) is behaviorally unchanged — same output, same `graph.json`/`files.json` contents as before this spec.

## Test plan

`packages/core/src/file-discovery.test.ts` (extend):
- Fast-path skip: seed a previous manifest matching a fixture file's actual `mtimeMs`/`size`; spy on `readFile`; assert it's never called for that path.
- Touched-but-same-content: use `utimes` to change a fixture file's mtime without changing content; assert it lands in `unchanged` with the same `hash` but updated `mtimeMs`.
- Modified/new/deleted classification, as in the acceptance criteria.

`packages/core/src/graph-gen.test.ts` (new):
- Feed a synthetic `previousGraph` (2 files' worth of nodes/edges) + `previousFiles` manifest, mock `discoverChangedFiles` to report file A changed and file B unchanged; assert the result contains B's original nodes untouched and A's freshly-parsed nodes, with no leftover A-owned edges from before.
- Deletion case: mock `discoverChangedFiles` reporting a deleted path; assert its nodes/edges are absent from the result.

Update `packages/core/src/sync.test.ts`:
- `incremental: true` with a readable previous graph/files on disk calls `generateGraph` with `previousGraph`/`previousFiles` populated.
- `incremental: true` with no previous sync on disk (read throws) still completes successfully, calling `generateGraph` with `previousGraph`/`previousFiles` both `undefined` (i.e. behaves like a full sync).

Update `packages/cli/src/commands/sync.test.ts` / add a `bin/nodum.test.ts` case (whichever is more natural given the existing test structure) verifying `--incremental` reaches `SyncHooks.incremental`.

## Success Metrics

- Real end-to-end check against a scratch copy of `benchmarks/projects/sample-next-app`: baseline `nodum sync`, then modify exactly one file and run `nodum sync --incremental` — resulting `graph.json` has correct total stats, and the untouched files' nodes are unchanged; a follow-up run with one file deleted correctly drops its nodes.
- `grep -c` confirms `discoverFiles`'s full-scan code path is unchanged (diffed against pre-spec-004 `file-discovery.ts`, only additions).

## Related

Depends on: `003-file-change-detection` (the manifest this reads).
Sets up: `006-cli-watch-mode` (will call `syncProject({ incremental: true })` on every detected file change).
