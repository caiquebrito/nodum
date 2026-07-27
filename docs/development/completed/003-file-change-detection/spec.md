# 003 — File change detection (manifest foundation for incremental sync)

## Status: done (2026-07-27) — verified via `npm run build`, `npm test --workspaces` (core 9/9 incl. 3 new file-discovery tests), and a real `nodum sync` against `benchmarks/projects/sample-next-app` confirming files.json has 4 entries with correct 64-char sha256 hashes, stable across re-sync, and graph.json unaffected

## Goal

Capture per-file hash/mtime/size during discovery and persist it as a manifest (`graph/files.json`) on every sync. This is pure plumbing — **no sync behavior changes**: every file is still fully read and parsed on every `nodum sync`, exactly as today. The manifest just gets recorded so spec 004 can diff against it to decide what actually needs re-parsing.

## Why now

Confirmed during the original codebase research: `discoverFiles()` reads every file's full content into memory unconditionally, and nothing about a file (hash, mtime, size) is ever recorded — `FileInfo` is just `{ path, ext, content }`, and `stat` is imported in `file-discovery.ts` but never called (dead import). There is no persisted record of what was synced last time, so there's currently no way to answer "did this file change since the last sync?" without literally re-parsing it. This spec is the prerequisite spec 004 needs.

Spec 002 (sync consolidation) is what makes this low-risk: `generateGraph()` is now called from exactly one place (`core/src/sync.ts`), so its return shape can change without touching `cli` or `mcp`.

## Scope

- `packages/core/src/types.ts` — extend `FileInfo` with `hash`, `mtimeMs`, `size`. Add `FileManifestEntry` / `FileManifest` types.
- `packages/core/src/file-discovery.ts` — compute the hash (of content already in memory) and call the existing-but-unused `stat()` for `mtimeMs`/`size` while walking the tree.
- `packages/core/src/graph-gen.ts` — `generateGraph()` return type changes from `Promise<Graph>` to `Promise<{ graph: Graph; files: FileManifest }>`.
- `packages/core/src/sync.ts` — destructure the new return shape, write `graph/files.json` alongside `graph/graph.json`.
- `packages/core/src/index.ts` — export the new types.

## Out of scope

- Actually skipping parsing for unchanged files, evicting stale nodes/edges for deleted files, or the `--incremental` CLI flag — that's spec 004, built on top of this manifest.
- Making `discoverFiles` avoid reading unchanged file content — can't do that yet since there's nothing to compare against on a file's *first* discovery in a given walk; the optimization only makes sense once spec 004 exists to consume the previous manifest. Recording it now, without using it yet, keeps this spec small and independently testable.
- Any change to `.gitignore` handling or `SUPPORTED_EXTENSIONS` — unrelated, out of scope here.

## Design

**`packages/core/src/types.ts`** — add:

```ts
export interface FileInfo {
  path: string;
  ext: string;
  content: string;
  hash: string;     // sha256 of `content`, hex-encoded
  mtimeMs: number;
  size: number;
}

export interface FileManifestEntry {
  hash: string;
  mtimeMs: number;
  size: number;
}

export type FileManifest = Record<string, FileManifestEntry>; // keyed by relative path
```

**`packages/core/src/file-discovery.ts`** — in `walkDirectory`, after reading content:

```ts
import { createHash } from 'crypto';
// ...
const content = await readFile(fullPath, 'utf-8');
const stats = await stat(fullPath);   // `stat` was already imported, never called
const hash = createHash('sha256').update(content).digest('hex');
files.push({
  path: relativePath,
  ext,
  content,
  hash,
  mtimeMs: stats.mtimeMs,
  size: stats.size,
});
```

**`packages/core/src/graph-gen.ts`**:

```ts
export async function generateGraph(
  projectPath: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ graph: Graph; files: FileManifest }> {
  const files = await discoverFiles(projectPath);
  // ... existing parse loop, unchanged ...

  const fileManifest: FileManifest = {};
  for (const file of files) {
    fileManifest[file.path] = { hash: file.hash, mtimeMs: file.mtimeMs, size: file.size };
  }

  return { graph, files: fileManifest };
}
```

**`packages/core/src/sync.ts`**:

```ts
const { graph, files: fileManifest } = await generateGraph(absolutePath, hooks.onParseProgress);
// ...
await writeFile(`${graphDir}/graph.json`, JSON.stringify(graph, null, 2), 'utf-8');
await writeFile(`${graphDir}/files.json`, JSON.stringify(fileManifest, null, 2), 'utf-8');
```

Written in the same step as `graph.json` (same `hooks.onStep?.('Writing graph.json')` call, no new step label needed — it's one atomic "write sync outputs" moment from the user's perspective).

## Acceptance criteria

- [x] `FileInfo` carries `hash`/`mtimeMs`/`size` on every discovered file.
- [x] `stat()` in `file-discovery.ts` is actually called (no more dead import).
- [x] `generateGraph()` returns `{ graph, files }`; `graph.json`'s own shape and content are byte-identical to before this change (no `files`/hash data leaks into `graph.json` — it's a separate file).
- [x] `nodum sync` against `benchmarks/projects/sample-next-app` produces `graph/files.json` containing one entry per discovered file, each with `hash`/`mtimeMs`/`size`.
- [x] Re-running `nodum sync` on an unchanged project produces byte-identical `hash` values in `files.json` (hash is deterministic, mtime/size may legitimately vary only if the file was actually touched on disk).
- [x] No behavior change to CLI output, MCP tool responses, or `graph.json` contents — this is additive-only.

## Test plan

`packages/core/src/file-discovery.test.ts` (new):
- Discovering a fixture file produces a `FileInfo` with a `hash` matching `sha256(content)` computed independently in the test.
- Two files with identical content produce identical hashes; a one-character difference produces a different hash.
- `mtimeMs`/`size` match `fs.stat()`'s own values for the fixture file.

Update `packages/core/src/sync.test.ts`:
- `generateGraphMock` now resolves `{ graph, files }` instead of a bare graph — update all test cases' mock return values.
- New case: `syncProject` writes `graph/files.json` with the manifest content, as a sibling write to `graph/graph.json`.

## Success Metrics

- `grep -n "import.*stat" packages/core/src/file-discovery.ts` shows `stat` actually used in the function body, not just imported.
- A real sync of `benchmarks/projects/sample-next-app` produces a `files.json` with exactly 4 entries (matching its 4 known source files).

## Related

Blocks: `004-incremental-graph-generation` (consumes this manifest to skip re-parsing unchanged files and evict deleted ones).
