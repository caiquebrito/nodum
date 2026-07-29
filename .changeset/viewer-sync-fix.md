---
"@caiquebrito/nodum-server": minor
---

Removes the viewer's Sync button, which called a `POST /api/sync` endpoint that has never existed — `packages/server` has been read-only by design since spec 047's hardening, and every click of the old button silently 404'd.

First of three specs in the v2.12.0 batch.
