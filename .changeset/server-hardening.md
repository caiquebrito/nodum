---
"@caiquebrito/nodum-server": patch
"@caiquebrito/nodum-cli": patch
---

Fixes a real path-traversal vulnerability in the `nodum serve` HTTP API: a URL-encoded `..%2F` project name could read `graph.json` files outside the intended `~/.nodum` data directory. Also fixes `nodum serve` binding to all network interfaces (`0.0.0.0`) by default with no authentication — it now binds to `127.0.0.1` by default; set `NODUM_HOST` to opt into a wider bind (a warning is printed when you do).

Also fixes a viewer bug where a project name containing `+`, a space, or non-ASCII characters wasn't URL-encoded in one of its fetch calls.

Second of four specs in the v2.10.0 batch.
