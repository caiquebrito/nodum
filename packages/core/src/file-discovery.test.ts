import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import { mkdtemp, writeFile, rm, stat, utimes, readFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { discoverFiles, discoverChangedFiles, IGNORED_DIRS } from "./file-discovery.js";
import type { FileManifest } from "./types.js";

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

describe("discoverFiles", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-"));
    await writeFile(join(dir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(join(dir, "b.ts"), "export const a = 1;\n", "utf-8"); // identical content to a.ts
    await writeFile(join(dir, "c.ts"), "export const c = 2;\n", "utf-8"); // different content
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("computes a hash matching sha256(content) for each file", async () => {
    const files = await discoverFiles(dir);
    const a = files.find(f => f.path === "a.ts")!;

    expect(a.hash).toBe(createHash("sha256").update(a.content).digest("hex"));
  });

  it("gives identical content the same hash, and different content a different hash", async () => {
    const files = await discoverFiles(dir);
    const a = files.find(f => f.path === "a.ts")!;
    const b = files.find(f => f.path === "b.ts")!;
    const c = files.find(f => f.path === "c.ts")!;

    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it("populates mtimeMs/size matching fs.stat()", async () => {
    const files = await discoverFiles(dir);
    const a = files.find(f => f.path === "a.ts")!;
    const stats = await stat(join(dir, "a.ts"));

    expect(a.mtimeMs).toBe(stats.mtimeMs);
    expect(a.size).toBe(stats.size);
  });
});

describe("discoverFiles — bounded concurrency (spec 042)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-concurrency-"));
    // More files than the internal concurrency limit, so multiple worker
    // batches are exercised — proving the concurrent read/stat/hash work
    // doesn't cross-contaminate results between files.
    for (let i = 0; i < 30; i++) {
      await writeFile(join(dir, `file${i}.ts`), `export const v${i} = ${i};\n`, "utf-8");
    }
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("discovers every file with content/hash matching its own path, not another file's", async () => {
    const files = await discoverFiles(dir);
    expect(files).toHaveLength(30);

    for (let i = 0; i < 30; i++) {
      const f = files.find(file => file.path === `file${i}.ts`)!;
      expect(f).toBeDefined();
      expect(f.content).toBe(`export const v${i} = ${i};\n`);
      expect(f.hash).toBe(createHash("sha256").update(f.content).digest("hex"));
    }
  });
});

describe("discoverChangedFiles", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-diff-"));
    await writeFile(join(dir, "unchanged.ts"), "export const u = 1;\n", "utf-8");
    await writeFile(join(dir, "modified.ts"), "export const m = 1;\n", "utf-8");
    await writeFile(join(dir, "touched.ts"), "export const t = 1;\n", "utf-8");
    await writeFile(join(dir, "toDelete.ts"), "export const d = 1;\n", "utf-8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function baselineManifest(): Promise<FileManifest> {
    const files = await discoverFiles(dir);
    const manifest: FileManifest = {};
    for (const f of files) manifest[f.path] = { hash: f.hash, mtimeMs: f.mtimeMs, size: f.size };
    return manifest;
  }

  it("skips reading unchanged files entirely (fast path)", async () => {
    const previous = await baselineManifest();
    (readFile as any).mockClear();

    const diff = await discoverChangedFiles(dir, previous);

    expect(diff.changed).toHaveLength(0);
    expect(Object.keys(diff.unchanged).sort()).toEqual(["modified.ts", "toDelete.ts", "touched.ts", "unchanged.ts"]);

    // readFile is still called once for .nodumrc.json and once for .gitignore
    // (fixed per-scan config-loading overhead, neither present in this
    // fixture) — but never for any of the fixture's own source files.
    const readFixtureFiles = (readFile as any).mock.calls.filter(
      ([path]: [string]) => !path.endsWith(".nodumrc.json") && !path.endsWith(".gitignore"),
    );
    expect(readFixtureFiles).toHaveLength(0);
  });

  it("classifies a touched-but-identical-content file as unchanged with a refreshed mtime", async () => {
    const previous = await baselineManifest();
    const before = previous["touched.ts"];

    // Bump mtime without changing content.
    const bumpedMs = before.mtimeMs + 5000;
    await utimes(join(dir, "touched.ts"), bumpedMs / 1000, bumpedMs / 1000);

    const diff = await discoverChangedFiles(dir, previous);

    expect(diff.changed.find(f => f.path === "touched.ts")).toBeUndefined();
    expect(diff.unchanged["touched.ts"].hash).toBe(before.hash);
    expect(diff.unchanged["touched.ts"].mtimeMs).not.toBe(before.mtimeMs);
  });

  it("classifies a genuinely modified file as changed", async () => {
    const previous = await baselineManifest();
    await writeFile(join(dir, "modified.ts"), "export const m = 999;\n", "utf-8");

    const diff = await discoverChangedFiles(dir, previous);

    const changed = diff.changed.find(f => f.path === "modified.ts");
    expect(changed).toBeDefined();
    expect(changed!.content).toContain("999");
    expect(diff.unchanged["modified.ts"]).toBeUndefined();
  });

  it("classifies a new file as changed", async () => {
    const previous = await baselineManifest();
    await writeFile(join(dir, "brandNew.ts"), "export const n = 1;\n", "utf-8");

    const diff = await discoverChangedFiles(dir, previous);

    expect(diff.changed.find(f => f.path === "brandNew.ts")).toBeDefined();

    await rm(join(dir, "brandNew.ts"));
  });

  it("classifies a removed file as deleted", async () => {
    const previous = await baselineManifest();
    await rm(join(dir, "toDelete.ts"));

    const diff = await discoverChangedFiles(dir, previous);

    expect(diff.deletedPaths).toContain("toDelete.ts");

    // restore for subsequent tests
    await writeFile(join(dir, "toDelete.ts"), "export const d = 1;\n", "utf-8");
  });
});

describe("discoverFiles — scan config integration", () => {
  let dir: string;

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not discover files matched by .gitignore", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-gitignore-"));
    await writeFile(join(dir, "kept.ts"), "export const k = 1;\n", "utf-8");
    await writeFile(join(dir, "secret.ts"), "export const s = 1;\n", "utf-8");
    await mkdir(join(dir, "ignored-dir"), { recursive: true });
    await writeFile(join(dir, "ignored-dir", "inner.ts"), "export const i = 1;\n", "utf-8");
    await writeFile(join(dir, ".gitignore"), "secret.ts\nignored-dir/\n", "utf-8");

    const files = await discoverFiles(dir);
    const paths = files.map(f => f.path).sort();

    expect(paths).toEqual(["kept.ts"]);
  });

  it("does not discover .go/.rs/.rb files — no parser supports them", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-phantom-ext-"));
    await writeFile(join(dir, "main.go"), "package main\n", "utf-8");
    await writeFile(join(dir, "lib.rs"), "fn main() {}\n", "utf-8");
    await writeFile(join(dir, "app.rb"), "puts 'hi'\n", "utf-8");
    await writeFile(join(dir, "kept.ts"), "export const k = 1;\n", "utf-8");

    const files = await discoverFiles(dir);

    expect(files.map(f => f.path)).toEqual(["kept.ts"]);
  });

  it("with .nodumrc.json include patterns, only matching files are discovered even without .gitignore", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-include-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export const x = 1;\n", "utf-8");
    await writeFile(join(dir, "outside.ts"), "export const y = 1;\n", "utf-8");
    await writeFile(join(dir, ".nodumrc.json"), JSON.stringify({ include: ["src/**"] }), "utf-8");

    const files = await discoverFiles(dir);

    expect(files.map(f => f.path)).toEqual(["src/index.ts"]);
  });

  it("skips a directory added via .nodumrc.json's ignoredDirs, on top of the built-in set", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-ignoreddirs-"));
    await writeFile(join(dir, "kept.ts"), "export const k = 1;\n", "utf-8");
    await mkdir(join(dir, ".terraform"), { recursive: true });
    await writeFile(join(dir, ".terraform", "inner.ts"), "export const i = 1;\n", "utf-8");
    await writeFile(join(dir, ".nodumrc.json"), JSON.stringify({ ignoredDirs: [".terraform"] }), "utf-8");

    const files = await discoverFiles(dir);

    expect(files.map(f => f.path)).toEqual(["kept.ts"]);
  });
});

describe("discoverFiles — guardrails (spec 042)", () => {
  let dir: string;

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("excludes an oversized file individually (with a warning), not the whole sync", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-oversized-"));
    await writeFile(join(dir, "normal.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(join(dir, "huge.ts"), "x".repeat(200), "utf-8");
    await writeFile(join(dir, ".nodumrc.json"), JSON.stringify({ maxFileSizeBytes: 100 }), "utf-8");

    const warnings: string[] = [];
    const files = await discoverFiles(dir, { onWarning: (m) => warnings.push(m) });

    expect(files.map(f => f.path).sort()).toEqual(["normal.ts"]);
    expect(warnings.some(w => w.includes("huge.ts"))).toBe(true);
  });

  it("does not warn when every file is within the size/count guardrails", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-withinlimits-"));
    await writeFile(join(dir, "normal.ts"), "export const a = 1;\n", "utf-8");

    const warnings: string[] = [];
    await discoverFiles(dir, { onWarning: (m) => warnings.push(m) });

    expect(warnings).toHaveLength(0);
  });

  it("warns (without excluding anything) once the file count exceeds maxFilesWarning", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-file-discovery-filecount-"));
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`, "utf-8");
    }
    await writeFile(join(dir, ".nodumrc.json"), JSON.stringify({ maxFilesWarning: 3 }), "utf-8");

    const warnings: string[] = [];
    const files = await discoverFiles(dir, { onWarning: (m) => warnings.push(m) });

    expect(files).toHaveLength(5);
    expect(warnings.some(w => w.includes("5 files"))).toBe(true);
  });
});

describe("IGNORED_DIRS", () => {
  it("merges the cross-cutting base set with every registered parser's own ignoredDirs", () => {
    // Cross-cutting, owned by no single parser.
    expect(IGNORED_DIRS.has("node_modules")).toBe(true);
    // Parser-contributed (spec 030) — Python, Kotlin/Java respectively.
    expect(IGNORED_DIRS.has("__pycache__")).toBe(true);
    expect(IGNORED_DIRS.has(".gradle")).toBe(true);
    expect(IGNORED_DIRS.has("target")).toBe(true);
  });
});
