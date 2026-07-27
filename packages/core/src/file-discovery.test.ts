import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "crypto";
import { mkdtemp, writeFile, rm, stat, utimes, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { discoverFiles, discoverChangedFiles } from "./file-discovery.js";
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
    expect(readFile).not.toHaveBeenCalled();
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
