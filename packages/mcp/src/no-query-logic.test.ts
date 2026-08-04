import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Guards against regressing back into the pre-spec-071 shape, where
// `packages/mcp/src` held the query logic itself (`handlers.ts`,
// `smart-context.ts`, `embeddings.ts`, etc.) rather than importing it from
// `@caiquebrito/nodum-query`. This package should now contain only the MCP
// transport adapter (`index.ts`) plus its own tests — no query-logic
// implementation files.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Names that would indicate query logic living directly in this package
// again, matching the module cluster spec 071 moved into `packages/query`.
const QUERY_LOGIC_MODULE_NAMES = [
  "handlers",
  "smart-context",
  "embeddings",
  "semantic-search",
  "conversation-cache",
  "graph-cache",
  "identifier-tokenize",
];

describe("packages/mcp holds no direct handler implementation (spec 071)", () => {
  it("has no query-logic source files under src/", () => {
    const files = readdirSync(SRC_DIR);
    for (const moduleName of QUERY_LOGIC_MODULE_NAMES) {
      expect(files).not.toContain(`${moduleName}.ts`);
    }
  });

  it("imports the query layer from @caiquebrito/nodum-query rather than a local module", () => {
    const indexSource = readFileSync(join(SRC_DIR, "index.ts"), "utf-8");
    expect(indexSource).toContain('from "@caiquebrito/nodum-query"');
    expect(indexSource).not.toMatch(/from ["']\.\/handlers\.js["']/);
  });
});
