import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { detectStack } from "./stack-detector.js";

// Real gap found during spec 049's own verification: a real Android
// project's root build.gradle.kts contained `com.android.application` but
// NOT `androidx.compose` — Compose lived only in a module's own build
// file. These tests reproduce that exact shape.
describe("detectStack — Gradle/Android (spec 049)", () => {
  let dir: string;

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("detects nothing for a project with no build.gradle at all", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-stack-none-"));
    const analysis = await detectStack(dir);
    expect(analysis.languages).toEqual([]);
    expect(analysis.buildTools).toEqual([]);
  });

  it("detects Kotlin/Gradle from a plain build.gradle (Groovy)", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-stack-groovy-"));
    await writeFile(join(dir, "build.gradle"), "apply plugin: 'com.android.application'");
    const analysis = await detectStack(dir);
    expect(analysis.languages).toContain("Kotlin/Java");
    expect(analysis.buildTools).toContain("Gradle");
    expect(analysis.frameworks).toContain("Android");
  });

  it("detects Kotlin/Gradle/Android from build.gradle.kts alone — the real detection gap this spec fixes", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-stack-kts-"));
    await writeFile(join(dir, "build.gradle.kts"), "plugins.withId(\"com.android.application\") {}");
    const analysis = await detectStack(dir);
    expect(analysis.languages).toContain("Kotlin/Java");
    expect(analysis.buildTools).toContain("Gradle");
    expect(analysis.frameworks).toContain("Android");
  });

  it("detects Jetpack Compose from a module's build file, not just the root's", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-stack-module-compose-"));
    await writeFile(join(dir, "build.gradle.kts"), "plugins.withId(\"com.android.application\") {}");
    await mkdir(join(dir, "app"));
    await writeFile(join(dir, "app", "build.gradle.kts"), "implementation(libs.androidx.compose.ui)");

    const analysis = await detectStack(dir);
    expect(analysis.frameworks).toContain("Android");
    expect(analysis.frameworks).toContain("Jetpack Compose");
  });

  it("does not detect Jetpack Compose when no build file mentions it", async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-stack-no-compose-"));
    await writeFile(join(dir, "build.gradle.kts"), "plugins.withId(\"com.android.application\") {}");
    const analysis = await detectStack(dir);
    expect(analysis.frameworks).not.toContain("Jetpack Compose");
  });
});
