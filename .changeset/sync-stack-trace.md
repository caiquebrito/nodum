---
"@caiquebrito/nodum-cli": minor
---

`nodum sync` failures now print the real underlying stack trace, not just a message — the wrapped error's `.stack` now includes the original error's stack (prefixed `Caused by:`), and the CLI's `sync` command prints it. Directly unblocks investigating the "Maximum call stack size exceeded" bug found in spec 056 without needing another expensive real-project sync just to see where it happened.
