/**
 * Locations of package files at runtime. Works from src/ (tests), dist/
 * (npm install) and server/dist/ (.mcpb bundle).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "simple-3d-modeling-mcp";

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        if (JSON.parse(readFileSync(candidate, "utf8")).name === PACKAGE_NAME) return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the ${PACKAGE_NAME} package root`);
}

export const PACKAGE_ROOT = findPackageRoot();
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
export const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
export const FONTS_DIR = join(ASSETS_DIR, "fonts");
export const LIBRARIES_DIR = join(ASSETS_DIR, "libraries");

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
