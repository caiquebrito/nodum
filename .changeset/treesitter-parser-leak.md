---
"@caiquebrito/nodum-core": minor
---

Fixes a real resource leak: every tree-sitter-backed parser (Python, Java, JavaScript, Kotlin, Go, Swift, Objective-C) creates a fresh `TSParser` instance per file but never freed it — only the parsed tree was deleted. On a large real project this leaks thousands of WASM parser instances. Real re-verification found this fix alone does not resolve a known large-project sync crash on some Node/V8 builds (confirmed Node-version-specific, with a separate stack-overflow bug also found in the process) — see ROADMAP.md for the full, honest account.

First of two specs in the v2.13.0 batch.
