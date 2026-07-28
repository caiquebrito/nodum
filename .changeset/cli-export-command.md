---
"@caiquebrito/nodum-cli": minor
---

`nodum export [projectPath] --format <json|graphml|csv> [--output <path>]` — export an already-synced project's graph for use in other tools. JSON export strips the `embedding` vectors (meaningless outside nodum's own semantic search). GraphML is real, importable GraphML for tools like Gephi/yEd/Cytoscape. CSV writes a `nodes.csv`/`edges.csv` pair with proper quote/comma escaping. Errors clearly if the project hasn't been synced yet, rather than silently syncing as a side effect.
