import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readBuildGradle, readGradleBuildFiles } from "./config-reader.js";

describe("readBuildGradle (spec 049)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-config-reader-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when neither variant is present", async () => {
    await expect(readBuildGradle(dir)).resolves.toBeNull();
  });

  it("reads the plain .gradle (Groovy) variant when present", async () => {
    await writeFile(join(dir, "build.gradle"), "apply plugin: 'com.android.application'");
    await expect(readBuildGradle(dir)).resolves.toContain("com.android.application");
    await rm(join(dir, "build.gradle"));
  });

  it("reads the .gradle.kts (Kotlin DSL) variant when the plain one is absent — the real detection gap this spec fixes", async () => {
    await writeFile(join(dir, "build.gradle.kts"), "plugins.withId(\"com.android.application\") {}");
    await expect(readBuildGradle(dir)).resolves.toContain("com.android.application");
    await rm(join(dir, "build.gradle.kts"));
  });

  it("prefers the plain .gradle variant when both are present", async () => {
    await writeFile(join(dir, "build.gradle"), "GROOVY_MARKER");
    await writeFile(join(dir, "build.gradle.kts"), "KTS_MARKER");
    await expect(readBuildGradle(dir)).resolves.toContain("GROOVY_MARKER");
    await rm(join(dir, "build.gradle"));
    await rm(join(dir, "build.gradle.kts"));
  });
});

describe("readGradleBuildFiles (spec 049)", () => {
  let dir: string;

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no build file exists anywhere", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-config-reader-none-"));
    await expect(readGradleBuildFiles(dir)).resolves.toBeNull();
  });

  it("includes both the root and a module's build file — the real gap: framework markers can live in a module's file, not the root's", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-config-reader-multi-"));
    await writeFile(join(dir, "build.gradle.kts"), "ROOT_MARKER com.android.application");
    await mkdir(join(dir, "app"));
    await writeFile(join(dir, "app", "build.gradle.kts"), "MODULE_MARKER androidx.compose");

    const combined = await readGradleBuildFiles(dir);
    expect(combined).toContain("ROOT_MARKER");
    expect(combined).toContain("MODULE_MARKER");
    expect(combined).toContain("androidx.compose");
  });

  it("skips node_modules/build/.git/.idea/dot-directories", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-config-reader-skip-"));
    await writeFile(join(dir, "build.gradle.kts"), "ROOT_MARKER");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "build.gradle.kts"), "SHOULD_NOT_APPEAR");
    await mkdir(join(dir, ".hidden"));
    await writeFile(join(dir, ".hidden", "build.gradle.kts"), "SHOULD_NOT_APPEAR_EITHER");

    const combined = await readGradleBuildFiles(dir);
    expect(combined).toContain("ROOT_MARKER");
    expect(combined).not.toContain("SHOULD_NOT_APPEAR");
  });

  it("only reads depth-1 module directories, not nested ones", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-config-reader-depth-"));
    await mkdir(join(dir, "app", "nested"), { recursive: true });
    await writeFile(join(dir, "app", "build.gradle.kts"), "APP_MARKER");
    await writeFile(join(dir, "app", "nested", "build.gradle.kts"), "NESTED_MARKER");

    const combined = await readGradleBuildFiles(dir);
    expect(combined).toContain("APP_MARKER");
    expect(combined).not.toContain("NESTED_MARKER");
  });
});
