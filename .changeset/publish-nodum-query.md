---
"@caiquebrito/nodum-query": patch
---

Publish `@caiquebrito/nodum-query` to npm. It was marked private in spec 071 (071-transport-neutral-query-layer), which kept it working inside this workspace via npm workspace symlinks but left it unpublished — since `@caiquebrito/nodum-mcp` depends on it as a normal registry dependency, every external `npm install -g @caiquebrito/nodum-mcp` has 404'd trying to resolve it since that spec shipped.
