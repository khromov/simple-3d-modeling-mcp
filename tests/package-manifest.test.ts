import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const npm11 = ["--yes", "npm@11.21.1"];
// npx is a .cmd shim on Windows, which execFile can only run through a shell.
const shell = process.platform === "win32";

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
}

function npmJson(args: string[]): unknown {
  return JSON.parse(execFileSync("npx", [...npm11, ...args, "--json"], {
    encoding: "utf8",
    shell,
  }));
}

describe("npm package manifest", () => {
  it("keeps the CLI bin in npm 11 pack and publish dry runs", () => {
    execFileSync("npx", [...npm11, "run", "build"], { shell });

    const publish = spawnSync(
      "npx",
      [...npm11, "publish", "--dry-run", "--ignore-scripts", "--loglevel=warn"],
      { encoding: "utf8", shell },
    );
    const packManifest = npmJson(["pack", "--dry-run", "--ignore-scripts"]) as PackResult[];
    const publishManifest = npmJson([
      "publish",
      "--dry-run",
      "--ignore-scripts",
    ]) as Record<string, PackResult>;
    const packDir = mkdtempSync(join(tmpdir(), "simple-3d-modeling-pack-"));

    try {
      const packed = npmJson([
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        packDir,
      ]) as PackResult[];
      const packageManifest = JSON.parse(execFileSync(
        "tar",
        ["-xOf", join(packDir, packed[0].filename), "package/package.json"],
        { encoding: "utf8" },
      ));

      expect(publish.status, publish.stderr).toBe(0);
      expect(publish.stderr).not.toContain("bin[simple-3d-modeling-mcp]");
      expect(packageManifest.bin).toEqual({
        "simple-3d-modeling-mcp": "dist/index.js",
      });
      expect(packManifest[0].files).toContainEqual(
        expect.objectContaining({ path: "dist/index.js" }),
      );
      // The WASM worker and the bundled fonts / BOSL2 must ship with the package.
      for (const path of ["dist/engine/wasm-worker.js", "assets/manifest.json", "assets/fonts/DejaVuSans.ttf", "assets/libraries/BOSL2/std.scad", "assets/libraries/BOSL2/LICENSE", "assets/vendor/three/three.core.js", "assets/vendor/three/addons/controls/OrbitControls.js"]) {
        expect(packManifest[0].files).toContainEqual(expect.objectContaining({ path }));
      }
      expect(packManifest[0].files.some((f) => f.path.startsWith("tests/"))).toBe(false);
      expect(publishManifest["simple-3d-modeling-mcp"].files).toContainEqual(
        expect.objectContaining({ path: "dist/index.js" }),
      );
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
