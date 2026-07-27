import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { mkdtemp, writeFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { discoverFiles } from "./file-discovery.js";

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
