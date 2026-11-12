import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Same npm version the release workflow publishes with.
const npm = ["--yes", "npm@12.2.2"];
const PACKAGE = "@khromov/simple-3d-modeling-mcp";
// npx is a .cmd shim on Windows, which execFile can only run through a shell.
const shell = process.platform === "win32";

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
}

/** npm 11 prints an array for `pack --json`; npm 12 an object keyed by package name. */
function firstResult(json: unknown): PackResult {
  return (Array.isArray(json) ? json[0] : Object.values(json as Record<string, PackResult>)[0]) as PackResult;
}

function npmJson(args: string[]): unknown {
  return JSON.parse(execFileSync("npx", [...npm, ...args, "--json"], {
    encoding: "utf8",
    shell,
  }));
}

describe("npm package manifest", () => {
  it("keeps the CLI bin in npm pack and publish dry runs", () => {
    execFileSync("npx", [...npm, "run", "build"], { shell });

    const publish = spawnSync(
      "npx",
      [...npm, "publish", "--dry-run", "--ignore-scripts", "--loglevel=warn"],
      { encoding: "utf8", shell },
    );
    const packManifest = firstResult(npmJson(["pack", "--dry-run", "--ignore-scripts"]));
    const publishManifest = npmJson([
      "publish",
      "--dry-run",
      "--ignore-scripts",
    ]) as Record<string, PackResult>;
    const packDir = mkdtempSync(join(tmpdir(), "simple-3d-modeling-pack-"));

    try {
      const packed = firstResult(npmJson([
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        packDir,
      ]));
      const packageManifest = JSON.parse(execFileSync(
        "tar",
        ["-xOf", join(packDir, packed.filename), "package/package.json"],
        { encoding: "utf8" },
      ));

      expect(publish.status, publish.stderr).toBe(0);
      expect(publish.stderr).not.toContain("bin[simple-3d-modeling-mcp]");
      expect(packageManifest.bin).toEqual({
        "simple-3d-modeling-mcp": "dist/index.js",
      });
      expect(packManifest.files).toContainEqual(
        expect.objectContaining({ path: "dist/index.js" }),
      );
      // The WASM worker, OpenSCAD itself, the bundled fonts / BOSL2 and the viewer page must ship with the package.
      for (const path of ["dist/engine/wasm-worker.js", "assets/manifest.json", "assets/openscad/openscad.mjs", "assets/openscad/openscad.wasm", "assets/fonts/DejaVuSans.ttf", "assets/libraries/BOSL2/std.scad", "assets/libraries/BOSL2/LICENSE", "dist/viewer-ui/index.html"]) {
        expect(packManifest.files).toContainEqual(expect.objectContaining({ path }));
      }
      expect(packManifest.files.some((f) => /^dist\/viewer-ui\/assets\/.+\.js$/.test(f.path))).toBe(true);
      expect(packManifest.files.some((f) => f.path.startsWith("viewer/"))).toBe(false);
      expect(packManifest.files.some((f) => f.path.startsWith("tests/"))).toBe(false);
      expect(packageManifest.name).toBe(PACKAGE);
      expect(packageManifest.publishConfig).toEqual({ access: "public" });
      expect(packageManifest.repository.url).toBe("git+https://github.com/khromov/simple-3d-modeling-mcp.git");
      expect(publishManifest[PACKAGE].files).toContainEqual(
        expect.objectContaining({ path: "dist/index.js" }),
      );
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
