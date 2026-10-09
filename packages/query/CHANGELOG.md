# @caiquebrito/nodum-query

## 2.18.0

### Minor Changes

- d2ea1b1: New local, fully offline decision log for cheap cross-session memory (spec 082): `nodum note "<message>"` appends a timestamped entry to `<project>/memory/DECISIONS.md` (capped at the most recent 50) and surfaces only the single latest entry into the project's `CLAUDE.md`, independent of `nodum sync`'s existing sync-stats block. `nodum notes [--limit N]` reads back recent entries. Two new MCP tools, `add_note`/`get_notes`, give an agent the same round trip mid-session without shelling out to the CLI.

### Patch Changes

- Updated dependencies [d2ea1b1]
  - @caiquebrito/nodum-core@2.18.0

## 2.17.3

### Patch Changes

- 5573921: Publish `@caiquebrito/nodum-query` to npm. It was marked private in spec 071 (071-transport-neutral-query-layer), which kept it working inside this workspace via npm workspace symlinks but left it unpublished — since `@caiquebrito/nodum-mcp` depends on it as a normal registry dependency, every external `npm install -g @caiquebrito/nodum-mcp` has 404'd trying to resolve it since that spec shipped.
- Updated dependencies [d85dce9]
  - @caiquebrito/nodum-core@2.17.3
