import { describe, it, expect, vi, beforeEach } from "vitest";

const loadScanConfigMock = vi.fn();
const saveScanConfigMock = vi.fn().mockResolvedValue(undefined);
const getAvailableParsersMock = vi.fn().mockReturnValue([
  { language: "typescript", extensions: [".ts", ".tsx"] },
  { language: "python", extensions: [".py"] },
]);

vi.mock("@caiquebrito/nodum-core", () => ({
  loadScanConfig: (...args: unknown[]) => loadScanConfigMock(...args),
  saveScanConfig: (...args: unknown[]) => saveScanConfigMock(...args),
  getAvailableParsers: (...args: unknown[]) => getAvailableParsersMock(...args),
}));

describe("nodum config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadScanConfigMock.mockResolvedValue({});
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
});
