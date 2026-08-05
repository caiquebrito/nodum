import { existsSync } from "fs";
import { basename, join } from "path";
import { syncProject, type Graph } from "@caiquebrito/nodum-core";
import { NODUM_DATA_DIR, handleSync, loadGraph } from "@caiquebrito/nodum-query";

/**
 * Owns one project's graph for the lifetime of the LSP server process. A
 * never-before-synced project gets one real full sync (with embeddings, via
 * the same `handleSync` the MCP server's `sync_project` tool calls) the
 * first time any capability needs graph data — an already-synced project
 * loads its existing `graph.json` from disk immediately, so `initialize`
 * itself is never blocked on a sync (see spec 072's "Server lifecycle" note
 * on this tradeoff). After the first load, every read comes from the
 * in-memory `graph` field — `resync()` updates it directly from
 * `syncProject`'s return value, so this class never re-reads
 * `packages/query`'s own TTL graph cache once warmed, sidestepping any
 * staleness question between the two.
 */
export class ProjectContext {
  readonly rootPath: string;
  readonly projectName: string;
  private graph: Graph | undefined;
  private pending: Promise<Graph> | undefined;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.projectName = basename(rootPath);
  }

  private hasExistingGraph(): boolean {
    return existsSync(join(NODUM_DATA_DIR, this.projectName, "graph", "graph.json"));
  }

  async ensureGraph(): Promise<Graph> {
    if (this.graph) return this.graph;
    if (this.pending) return this.pending;

    this.pending = (this.hasExistingGraph() ? loadGraph(this.projectName) : this.fullSync())
      .then((graph) => {
        this.graph = graph;
        return graph;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async fullSync(): Promise<Graph> {
    const result = await handleSync(this.rootPath);
    if ("isError" in result && result.isError) {
      throw new Error(result.content[0]?.text ?? `Failed to sync ${this.rootPath}`);
    }
    return loadGraph(this.projectName);
  }

  /** `didSave` / `didChangeWatchedFiles` handler. Deliberately calls
   * `syncProject` directly rather than `handleSync` — an incremental resync
   * triggered on every save shouldn't pay embeddings' cost on every
   * keystroke-adjacent save when no capability this spec implements uses
   * semantic search. */
  async resync(): Promise<Graph> {
    const graph = await syncProject(this.rootPath, NODUM_DATA_DIR, { incremental: true });
    this.graph = graph;
    return graph;
  }

  currentGraph(): Graph | undefined {
    return this.graph;
  }
}
