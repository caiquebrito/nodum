---
"@caiquebrito/nodum-core": minor
"@caiquebrito/nodum-mcp": minor
---

Labels Gradle modules (`forro/feature`, `app`, ...) on `Node.module`, derived purely from file path convention — no `settings.gradle` parsing needed. `mcp get_node` shows a `Module:` line when present. Also removes the confirmed-dead `readSettingsGradle` from `config-reader.ts`.

Second of three specs in the v2.11.0 batch.
