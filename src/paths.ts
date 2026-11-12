/**
 * Locations of package files at runtime. Works from src/ (tests), dist/
 * (npm install) and server/dist/ (.mcpb bundle).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Matches "simple-3d-modeling-mcp" and scoped copies such as "@khromov/simple-3d-modeling-mcp". */
const PACKAGE_NAME_RE = /^(@[^/]+\/)?simple-3d-modeling-mcp$/;

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        if (PACKAGE_NAME_RE.test(JSON.parse(readFileSync(candidate, "utf8")).name)) return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the simple-3d-modeling-mcp package root");
}

export const PACKAGE_ROOT = findPackageRoot();
const PACKAGE_JSON = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
export const PACKAGE_NAME: string = PACKAGE_JSON.name;
export const PACKAGE_VERSION: string = PACKAGE_JSON.version;
export const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
export const FONTS_DIR = join(ASSETS_DIR, "fonts");
export const LIBRARIES_DIR = join(ASSETS_DIR, "libraries");
/** OpenSCAD's official WebAssembly build: openscad.mjs (Emscripten glue) + openscad.wasm. */
export const OPENSCAD_WASM_DIR = join(ASSETS_DIR, "openscad");
/** The browser viewer page, built from viewer/ by Vite (`npm run build:viewer`). */
export const VIEWER_UI_DIR = join(PACKAGE_ROOT, "dist", "viewer-ui");

/** Names of libraries bundled under assets/libraries (e.g. ["BOSL2"]). */
export function bundledLibraries(): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, "manifest.json"), "utf8"));
    return manifest.bosl2 ? ["BOSL2"] : [];
  } catch {
    return [];
  }
}

export function bundledLibraryVersion(name: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, "manifest.json"), "utf8"));
    return name === "BOSL2" ? manifest.bosl2 : undefined;
  } catch {
    return undefined;
  }
}
