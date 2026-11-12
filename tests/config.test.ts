import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutputDir, readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("uses sensible defaults", () => {
    const { config, warnings } = readConfig({});
    expect(config).toEqual({
      engineMode: "auto",
      openscadPath: undefined,
      workDir: undefined,
      timeoutMs: 120_000,
      outputDir: defaultOutputDir(),
      autoOpenViewer: true,
    });
    expect(warnings).toEqual([]);
  });

  it("parses values and expands ~", () => {
    const { config } = readConfig({
      OPENSCAD_ENGINE: "WASM",
      OPENSCAD_PATH: "/opt/openscad",
      OPENSCAD_TIMEOUT: "30",
      OPENSCAD_OUTPUT_DIR: "~/models",
      OPENSCAD_AUTO_OPEN_VIEWER: "false",
    });
    expect(config).toMatchObject({
      engineMode: "wasm",
      openscadPath: "/opt/openscad",
      timeoutMs: 30_000,
      outputDir: join(homedir(), "models"),
      autoOpenViewer: false,
    });
  });

  it("ignores blank and unsubstituted .mcpb placeholders", () => {
    const { config } = readConfig({
      OPENSCAD_PATH: "${user_config.openscad_path}",
      OPENSCAD_OUTPUT_DIR: "  ",
      OPENSCAD_AUTO_OPEN_VIEWER: "",
    });
    expect(config.openscadPath).toBeUndefined();
    expect(config.outputDir).toBe(defaultOutputDir());
    expect(config.autoOpenViewer).toBe(true);
  });

  it("warns about invalid values", () => {
    const { config, warnings } = readConfig({ OPENSCAD_ENGINE: "gpu", OPENSCAD_TIMEOUT: "soon", OPENSCAD_OUTPUT_DIR: "relative/dir" });
    expect(config.engineMode).toBe("auto");
    expect(config.timeoutMs).toBe(120_000);
    expect(warnings).toHaveLength(3);
  });

  it("clamps the timeout", () => {
    expect(readConfig({ OPENSCAD_TIMEOUT: "1" }).config.timeoutMs).toBe(5_000);
    expect(readConfig({ OPENSCAD_TIMEOUT: "99999" }).config.timeoutMs).toBe(3_600_000);
  });
});
