import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parseManifestEntryPoints, findManifestEntryFiles } from "./android-manifest.js";
import { normalizeNodeId } from "../types.js";
import type { Node } from "../types.js";

describe("parseManifestEntryPoints", () => {
  it("resolves a package-relative android:name (leading dot) against the manifest package", () => {
    const xml = `
      <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
        <application android:name=".PokemonApplication">
          <activity android:name=".StartActivity" />
        </application>
      </manifest>
    `;
    expect(parseManifestEntryPoints(xml)).toEqual([
      "com.example.app.PokemonApplication",
      "com.example.app.StartActivity",
    ]);
  });

  it("leaves an already fully-qualified android:name untouched", () => {
    const xml = `
      <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
        <service android:name="com.example.other.SyncService" />
      </manifest>
    `;
    expect(parseManifestEntryPoints(xml)).toEqual(["com.example.other.SyncService"]);
  });

  it("ignores tags with no android:name (default Application class)", () => {
    const xml = `
      <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
        <application>
          <activity android:name=".MainActivity" />
        </application>
      </manifest>
    `;
    expect(parseManifestEntryPoints(xml)).toEqual(["com.example.app.MainActivity"]);
  });

  it("returns [] for a manifest with no entry-point tags", () => {
    const xml = `<manifest package="com.example.app"></manifest>`;
    expect(parseManifestEntryPoints(xml)).toEqual([]);
  });

  it("extracts receiver and provider entries too", () => {
    const xml = `
      <manifest package="com.example.app">
        <application>
          <receiver android:name=".BootReceiver" />
          <provider android:name=".AppContentProvider" />
        </application>
      </manifest>
    `;
    expect(parseManifestEntryPoints(xml).sort()).toEqual([
      "com.example.app.AppContentProvider",
      "com.example.app.BootReceiver",
    ].sort());
  });
});

describe("findManifestEntryFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-android-manifest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function fileNode(path: string): Node {
    return { id: normalizeNodeId(path, path, "file"), label: path, type: "file", file: path, group: "other" };
  }

  it("resolves a manifest entry point to its real file path in the graph", async () => {
    await mkdir(join(dir, "app/src/main/kotlin/com/example/app"), { recursive: true });
    await writeFile(
      join(dir, "app/src/main/AndroidManifest.xml"),
      `<manifest package="com.example.app"><application android:name=".PokemonApplication" /></manifest>`,
      "utf-8",
    );

    const filePath = "app/src/main/kotlin/com/example/app/PokemonApplication.kt";
    const graphNodes = [fileNode(filePath)];

    const entryFiles = await findManifestEntryFiles(dir, graphNodes);
    expect(entryFiles).toEqual([filePath]);
  });

  it("finds manifests in every module of a multi-module project", async () => {
    await mkdir(join(dir, "app/src/main/kotlin/com/example/app"), { recursive: true });
    await mkdir(join(dir, "feature-x/src/main/kotlin/com/example/featurex"), { recursive: true });
    await writeFile(
      join(dir, "app/src/main/AndroidManifest.xml"),
      `<manifest package="com.example.app"><application android:name=".PokemonApplication" /></manifest>`,
      "utf-8",
    );
    await writeFile(
      join(dir, "feature-x/src/main/AndroidManifest.xml"),
      `<manifest package="com.example.featurex"><service android:name=".SyncService" /></manifest>`,
      "utf-8",
    );

    const graphNodes = [
      fileNode("app/src/main/kotlin/com/example/app/PokemonApplication.kt"),
      fileNode("feature-x/src/main/kotlin/com/example/featurex/SyncService.kt"),
    ];

    const entryFiles = await findManifestEntryFiles(dir, graphNodes);
    expect(entryFiles.sort()).toEqual([
      "app/src/main/kotlin/com/example/app/PokemonApplication.kt",
      "feature-x/src/main/kotlin/com/example/featurex/SyncService.kt",
    ].sort());
  });

  it("returns [] when no AndroidManifest.xml exists under rootPath", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    const entryFiles = await findManifestEntryFiles(dir, [fileNode("src/index.ts")]);
    expect(entryFiles).toEqual([]);
  });

  it("skips a manifest entry point that doesn't resolve to any known graph file", async () => {
    await writeFile(
      join(dir, "AndroidManifest.xml"),
      `<manifest package="com.example.app"><application android:name=".Missing" /></manifest>`,
      "utf-8",
    );
    const entryFiles = await findManifestEntryFiles(dir, [fileNode("app/Other.kt")]);
    expect(entryFiles).toEqual([]);
  });
});
