---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-cli": minor
---

`nodum architecture [projectPath] [--json] [--rule <from>:<to>]` — detect `imports` edges that violate declared layer rules (e.g. `ui:repo` disallows the `ui` group importing the `repo` group), using each node's existing group classification. Deny-list only, opt-in, with `*` wildcard support. Persist rules via `nodum config --set-architecture-rules <from>:<to>,...`, stored in `.nodumrc.json` under a new `architecture.rules` key. `detectArchitectureViolations()`/`loadArchitectureConfig()`/`saveArchitectureConfig()` are exported from `nodum-core` for reuse.

Also fixes a latent bug in `saveScanConfig`: it previously round-tripped through only its own typed fields, silently deleting any other top-level key in `.nodumrc.json` (like the new `architecture` key) on the next `--set-include`/`--set-exclude`. It now merges into the raw JSON instead.
