import { describe, it, expect, vi, beforeEach } from "vitest";

const loadScanConfigMock = vi.fn();
const saveScanConfigMock = vi.fn().mockResolvedValue(undefined);
const loadArchitectureConfigMock = vi.fn();
const saveArchitectureConfigMock = vi.fn().mockResolvedValue(undefined);
const getAvailableParsersMock = vi.fn().mockReturnValue([
  { language: "typescript", extensions: [".ts", ".tsx"] },
  { language: "python", extensions: [".py"] },
]);

vi.mock("@caiquebrito/nodum-core", () => ({
  loadScanConfig: (...args: unknown[]) => loadScanConfigMock(...args),
  saveScanConfig: (...args: unknown[]) => saveScanConfigMock(...args),
  loadArchitectureConfig: (...args: unknown[]) => loadArchitectureConfigMock(...args),
  saveArchitectureConfig: (...args: unknown[]) => saveArchitectureConfigMock(...args),
  getAvailableParsers: (...args: unknown[]) => getAvailableParsersMock(...args),
}));

describe("nodum config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadScanConfigMock.mockResolvedValue({});
    loadArchitectureConfigMock.mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows the resolved config without writing anything when no --set flags are given", async () => {
    const { showOrUpdateConfig } = await import("./config.js");
    await showOrUpdateConfig("/tmp/project", {});

    expect(saveScanConfigMock).not.toHaveBeenCalled();
    expect(loadScanConfigMock).toHaveBeenCalledWith("/tmp/project");
  });

  it("--set-exclude writes parsed patterns to .nodumrc.json via saveScanConfig", async () => {
    const { showOrUpdateConfig } = await import("./config.js");
    await showOrUpdateConfig("/tmp/project", { setExclude: "**/*.gen.ts, **/*.spec.ts" });

    expect(saveScanConfigMock).toHaveBeenCalledWith("/tmp/project", {
      exclude: ["**/*.gen.ts", "**/*.spec.ts"],
    });
  });

  it("--set-include writes parsed patterns to .nodumrc.json via saveScanConfig", async () => {
    const { showOrUpdateConfig } = await import("./config.js");
    await showOrUpdateConfig("/tmp/project", { setInclude: "src/**" });

    expect(saveScanConfigMock).toHaveBeenCalledWith("/tmp/project", { include: ["src/**"] });
  });

  it("--set-architecture-rules writes parsed from:to pairs via saveArchitectureConfig", async () => {
    const { showOrUpdateConfig } = await import("./config.js");
    await showOrUpdateConfig("/tmp/project", { setArchitectureRules: "ui:repo, model:service" });

    expect(saveArchitectureConfigMock).toHaveBeenCalledWith("/tmp/project", {
      rules: [
        { from: "ui", to: "repo" },
        { from: "model", to: "service" },
      ],
    });
  });

  it("displays persisted architecture rules in the summary output", async () => {
    loadArchitectureConfigMock.mockResolvedValue({ rules: [{ from: "ui", to: "repo" }] });
    const { showOrUpdateConfig } = await import("./config.js");
    await showOrUpdateConfig("/tmp/project", {});

    const allLogs = (console.log as any).mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(allLogs).toContain("Architecture rules: ui→repo");
  });
});
