import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadArchitectureConfig, saveArchitectureConfig } from "./architecture-config.js";
import { saveScanConfig, loadScanConfig } from "../scan-config.js";

describe("architecture-config", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nodum-architecture-config-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when .nodumrc.json is absent", async () => {
    await expect(loadArchitectureConfig(dir)).resolves.toEqual({});
  });

  it("round-trips rules through save/load", async () => {
    await saveArchitectureConfig(dir, { rules: [{ from: "ui", to: "repo" }] });
    await expect(loadArchitectureConfig(dir)).resolves.toEqual({ rules: [{ from: "ui", to: "repo" }] });
    await rm(join(dir, ".nodumrc.json"));
  });

  it("does not delete architecture rules when scan config is saved afterward (clobber regression guard)", async () => {
    await saveArchitectureConfig(dir, { rules: [{ from: "model", to: "*" }] });
    await saveScanConfig(dir, { include: ["src/**"] });

    await expect(loadArchitectureConfig(dir)).resolves.toEqual({ rules: [{ from: "model", to: "*" }] });
    await expect(loadScanConfig(dir)).resolves.toEqual({ include: ["src/**"] });

    await rm(join(dir, ".nodumrc.json"));
  });

  it("does not delete scan config when architecture rules are saved afterward", async () => {
    await saveScanConfig(dir, { exclude: ["**/*.spec.ts"] });
    await saveArchitectureConfig(dir, { rules: [{ from: "ui", to: "repo" }] });

    await expect(loadScanConfig(dir)).resolves.toEqual({ exclude: ["**/*.spec.ts"] });
    await expect(loadArchitectureConfig(dir)).resolves.toEqual({ rules: [{ from: "ui", to: "repo" }] });

    await rm(join(dir, ".nodumrc.json"));
  });
});
