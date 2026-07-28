import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadScanConfig, saveScanConfig, buildFileMatcher } from "./scan-config.js";

describe("scan-config", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-scan-config-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("loadScanConfig", () => {
    it("returns {} when .nodumrc.json is absent", async () => {
      await expect(loadScanConfig(dir)).resolves.toEqual({});
    });

    it("returns parsed content when .nodumrc.json is present", async () => {
      await writeFile(join(dir, ".nodumrc.json"), JSON.stringify({ include: ["src/**"], exclude: ["**/*.gen.ts"] }));

      await expect(loadScanConfig(dir)).resolves.toEqual({ include: ["src/**"], exclude: ["**/*.gen.ts"] });

      await rm(join(dir, ".nodumrc.json"));
    });

    it("returns {} (not a throw) for malformed JSON", async () => {
      await writeFile(join(dir, ".nodumrc.json"), "{not valid json");

      await expect(loadScanConfig(dir)).resolves.toEqual({});

      await rm(join(dir, ".nodumrc.json"));
    });
  });

  describe("saveScanConfig", () => {
    it("writes a new .nodumrc.json", async () => {
      await saveScanConfig(dir, { exclude: ["**/*.spec.ts"] });

      await expect(loadScanConfig(dir)).resolves.toEqual({ exclude: ["**/*.spec.ts"] });

      await rm(join(dir, ".nodumrc.json"));
    });

    it("merges with existing content rather than clobbering unspecified fields", async () => {
      await saveScanConfig(dir, { include: ["src/**"] });
      await saveScanConfig(dir, { exclude: ["**/*.spec.ts"] });

      await expect(loadScanConfig(dir)).resolves.toEqual({ include: ["src/**"], exclude: ["**/*.spec.ts"] });

      await rm(join(dir, ".nodumrc.json"));
    });
  });

  describe("buildFileMatcher", () => {
    it("excludes a path matching a .gitignore line", async () => {
      await writeFile(join(dir, ".gitignore"), "ignored-dir/\nsecret.ts\n");

      const matcher = await buildFileMatcher(dir, {});

      expect(matcher.isExcluded("secret.ts")).toBe(true);
      expect(matcher.isExcluded("kept.ts")).toBe(false);
      // Directory-only gitignore patterns (trailing slash) only match a
      // trailing-slash test path — the caller (walkFiles) is responsible
      // for appending it when checking a directory entry.
      expect(matcher.isExcluded("ignored-dir/")).toBe(true);
      expect(matcher.isExcluded("ignored-dir")).toBe(false);

      await rm(join(dir, ".gitignore"));
    });

    it("excludes a path matching config.exclude, with no .gitignore present", async () => {
      const matcher = await buildFileMatcher(dir, { exclude: ["**/*.generated.ts"] });

      expect(matcher.isExcluded("foo.generated.ts")).toBe(true);
      expect(matcher.isExcluded("foo.ts")).toBe(false);
    });

    it("with config.include set, only matching file paths pass — but a containing directory is never excluded by include rules alone", async () => {
      const matcher = await buildFileMatcher(dir, { include: ["src/**"] });

      expect(matcher.isIncluded("src/index.ts")).toBe(true);
      expect(matcher.isIncluded("other/index.ts")).toBe(false);
      // Directory pruning must only ever consult isExcluded, never
      // isIncluded — src/** legitimately doesn't match the "src/" directory
      // path itself, only files inside it.
      expect(matcher.isExcluded("src/")).toBe(false);
      expect(matcher.isExcluded("other/")).toBe(false);
    });
  });
});
