#!/usr/bin/env node
/**
 * Populates ./assets with the files the WASM engine mounts into OpenSCAD's
 * virtual filesystem:
 *
 *   assets/openscad/           OpenSCAD's official WebAssembly build (nightly snapshot, pinned date, sha256-verified)
 *   assets/fonts/              DejaVu TTFs (from the dejavu-fonts-ttf devDependency)
 *   assets/libraries/BOSL2/    BOSL2 library (downloaded at a pinned tag, sha256-verified)
 *
 * The directory is git-ignored and shipped in the npm package / .mcpb bundle.
 * Re-running is cheap: it exits early when assets/manifest.json matches.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import AdmZip from "adm-zip";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const MANIFEST = join(ASSETS, "manifest.json");

// The "web" variant is an ES module factory plus a separate .wasm, run in-process
// on a virtual filesystem. (The "node" variant is a CLI with host filesystem access.)
// files.openscad.org keeps dated snapshots for months, not forever: bump when a pin disappears.
// The newest day's snapshot can still be rebuilt under the same name (2026.11.12 was, late that
// day), so pin one that is a few days old.
const OPENSCAD = {
  version: "2026.11.12",
  url: "https://files.openscad.org/snapshots/OpenSCAD-2026.11.12-WebAssembly-web.zip",
  sha256: "2d9cccd2bda9593a1208a7b5b12a45be72b78eb9a4226ef8d3d3f74a139f733e",
};

const BOSL2 = {
  tag: "v2.0.785",
  url: "https://codeload.github.com/BelfrySCAD/BOSL2/tar.gz/refs/tags/v2.0.785",
  sha256: "bf3af21a9cdb12afb68baa392c74aaf4cc2430a8d4ac3657da7c95794f8f94bc",
};

const FONT_FILES = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Oblique.ttf",
  "DejaVuSans-BoldOblique.ttf",
  "DejaVuSansMono.ttf",
  "DejaVuSansMono-Bold.ttf",
  "DejaVuSerif.ttf",
  "DejaVuSerif-Bold.ttf",
];

const require = createRequire(import.meta.url);
const fontPkgDir = dirname(require.resolve("dejavu-fonts-ttf/package.json"));
const fontVersion = JSON.parse(readFileSync(join(fontPkgDir, "package.json"), "utf8")).version;

// Checksums too: a pin can change without a new version (a rebuilt snapshot), and existing assets must follow it.
const wanted = {
  openscad: OPENSCAD.version,
  openscadSha256: OPENSCAD.sha256,
  bosl2: BOSL2.tag,
  bosl2Sha256: BOSL2.sha256,
  fonts: fontVersion,
  fontFiles: FONT_FILES,
};

if (existsSync(MANIFEST)) {
  try {
    const have = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (JSON.stringify(have) === JSON.stringify(wanted)) {
      console.log("assets: up to date");
      process.exit(0);
    }
  } catch {
    // fall through and rebuild
  }
}

rmSync(ASSETS, { recursive: true, force: true });

// --- Fonts -----------------------------------------------------------------
const fontsDir = join(ASSETS, "fonts");
mkdirSync(fontsDir, { recursive: true });
for (const f of FONT_FILES) copyFileSync(join(fontPkgDir, "ttf", f), join(fontsDir, f));
copyFileSync(join(fontPkgDir, "LICENSE"), join(fontsDir, "LICENSE"));
console.log(`assets: copied ${FONT_FILES.length} DejaVu fonts (${fontVersion})`);

// --- OpenSCAD (WebAssembly) --------------------------------------------------
const zip = await download("OpenSCAD", OPENSCAD.url, OPENSCAD.sha256);
const openscadDir = join(ASSETS, "openscad");
mkdirSync(openscadDir, { recursive: true });
const archive = new AdmZip(zip);
const zipFile = (name) => {
  const entry = archive.getEntry(name);
  if (!entry) throw new Error(`OpenSCAD zip is missing ${name}`);
  return entry.getData();
};
// .mjs: the glue is an ES module, whatever package.json ends up next to it.
writeFileSync(join(openscadDir, "openscad.mjs"), zipFile("openscad.js"));
writeFileSync(join(openscadDir, "openscad.wasm"), zipFile("openscad.wasm"));
writeFileSync(
  join(openscadDir, "NOTICE"),
  `OpenSCAD ${OPENSCAD.version} compiled to WebAssembly by the OpenSCAD project.\n` +
    `Downloaded from ${OPENSCAD.url}\n(sha256 ${OPENSCAD.sha256}).\n\n` +
    "OpenSCAD is free software. Source code and license: https://github.com/openscad/openscad\n",
);
console.log(`assets: extracted OpenSCAD ${OPENSCAD.version} (WebAssembly)`);

// --- BOSL2 -----------------------------------------------------------------
const tgz = await download("BOSL2", BOSL2.url, BOSL2.sha256);

const libDir = join(ASSETS, "libraries", "BOSL2");
mkdirSync(libDir, { recursive: true });
let count = 0;
for (const entry of readTar(gunzipSync(tgz))) {
  // GitHub tarballs have a single top-level folder: BOSL2-<version>/...
  const parts = entry.name.split("/");
  if (parts.length !== 2) continue; // only top-level library files
  const base = parts[1];
  if (base.endsWith(".scad") || base === "LICENSE") {
    writeFileSync(join(libDir, base), entry.data);
    count++;
  }
}
if (count < 10) throw new Error(`BOSL2 extraction looks wrong (${count} files)`);
console.log(`assets: extracted BOSL2 ${BOSL2.tag} (${count} files)`);

writeFileSync(MANIFEST, JSON.stringify(wanted, null, 2) + "\n");

/** Downloads a file and checks it against a pinned SHA-256. */
async function download(label, url, sha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} download failed: HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== sha256) throw new Error(`${label} checksum mismatch: expected ${sha256}, got ${digest}`);
  return buf;
}

/** Minimal ustar reader: yields regular files only. */
function* readTar(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a, b) => header.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = str(156, 157);
    const prefix = str(345, 500);
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const dataStart = off + 512;
    if (type === "0" || type === "") {
      yield { name, data: buf.subarray(dataStart, dataStart + size) };
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
}
