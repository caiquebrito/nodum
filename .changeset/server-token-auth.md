---
"@caiquebrito/nodum-server": patch
"@caiquebrito/nodum-cli": patch
---

`nodum serve` now requires a token on `/api/*` requests when bound beyond loopback (`NODUM_HOST=0.0.0.0` or a LAN IP). A single token is generated once per data directory (`~/.nodum/server-token`), printed on start along with a ready-to-open `?token=...` URL, and checked via `Authorization: Bearer <token>` or `?token=` using a constant-time comparison. Loopback binds (the default) are completely unaffected — no token is generated and no credential is required, matching today's behavior exactly.
