import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutputDir, readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("uses sensible defaults", () => {
    const { config, warnings } = readConfig({});
    expect(config).toEqual({
      timeoutMs: 120_000,
      outputDir: defaultOutputDir(),
      autoOpenViewer: true,
    });
    expect(warnings).toEqual([]);
  });

  it("parses values and expands ~", () => {
    const { config } = readConfig({
      OPENSCAD_TIMEOUT: "30",
      OPENSCAD_OUTPUT_DIR: "~/models",
      OPENSCAD_AUTO_OPEN_VIEWER: "false",
    });
    expect(config).toEqual({
      timeoutMs: 30_000,
      outputDir: join(homedir(), "models"),
      autoOpenViewer: false,
    });
  });

  it("ignores blank and unsubstituted .mcpb placeholders", () => {
    const { config, warnings } = readConfig({
      OPENSCAD_PATH: "${user_config.openscad_path}",
      OPENSCAD_OUTPUT_DIR: "  ",
      OPENSCAD_AUTO_OPEN_VIEWER: "",
    });
    expect(config.outputDir).toBe(defaultOutputDir());
    expect(config.autoOpenViewer).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("warns about invalid values", () => {
    const { config, warnings } = readConfig({ OPENSCAD_TIMEOUT: "soon", OPENSCAD_OUTPUT_DIR: "relative/dir" });
    expect(config.timeoutMs).toBe(120_000);
    expect(config.outputDir).toBe(defaultOutputDir());
    expect(warnings).toHaveLength(2);
  });

  it("warns that the native OpenSCAD settings are gone", () => {
    const { warnings } = readConfig({ OPENSCAD_ENGINE: "native", OPENSCAD_PATH: "/opt/openscad", OPENSCAD_WORK_DIR: "/tmp/x" });
    expect(warnings).toEqual(
      ["OPENSCAD_ENGINE", "OPENSCAD_PATH", "OPENSCAD_WORK_DIR"].map((name) => `Ignoring ${name}: OpenSCAD always runs bundled as WebAssembly.`),
    );
  });

  it("clamps the timeout", () => {
    expect(readConfig({ OPENSCAD_TIMEOUT: "1" }).config.timeoutMs).toBe(5_000);
    expect(readConfig({ OPENSCAD_TIMEOUT: "99999" }).config.timeoutMs).toBe(3_600_000);
  });
});
