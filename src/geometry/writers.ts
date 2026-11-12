/**
 * Mesh exporters: binary STL, OBJ, OFF and 3MF.
 *
 * Building these from the cached mesh means an export right after a render
 * needs no further OpenSCAD work, and it sidesteps the WASM build's broken
 * 3MF exporter.
 */

import { isDefaultColor, weldVertices, type Mesh } from "./mesh.js";
import { createZip } from "./zip.js";

const encoder = new TextEncoder();

export function writeBinaryStl(mesh: Mesh, header = "sketchpad-3d-model-mcp"): Uint8Array {
  const { positions: p, indices: idx } = mesh;
  const count = idx.length / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const bytes = new Uint8Array(buf);
  bytes.set(encoder.encode(header.slice(0, 80)));
  const view = new DataView(buf);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const off = 84 + t * 50;
    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    let o = off + 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p[v], true);
      view.setFloat32(o + 4, p[v + 1], true);
      view.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
  }
  return bytes;
}

function num(v: number): string {
  // Float32 data: 6 significant decimals is lossless enough and keeps files small.
  const s = (+v.toFixed(6)).toString();
  return s === "-0" ? "0" : s;
}

export function writeObj(mesh: Mesh): Uint8Array {
  const m = weldVertices(mesh);
  const lines: string[] = ["# sketchpad-3d-model-mcp"];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  const idx = m.indices;
  for (let i = 0; i < idx.length; i += 3) lines.push(`f ${idx[i] + 1} ${idx[i + 1] + 1} ${idx[i + 2] + 1}`);
  return encoder.encode(lines.join("\n") + "\n");
}

export function writeOff(mesh: Mesh): Uint8Array {
  const p = mesh.positions, idx = mesh.indices, c = mesh.colors;
  const lines: string[] = ["OFF", `${p.length / 3} ${idx.length / 3} 0`];
  for (let i = 0; i < p.length; i += 3) lines.push(`${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  for (let t = 0; t < idx.length / 3; t++) {
    let line = `3 ${idx[t * 3]} ${idx[t * 3 + 1]} ${idx[t * 3 + 2]}`;
    if (c) line += ` ${c[t * 4]} ${c[t * 4 + 1]} ${c[t * 4 + 2]}${c[t * 4 + 3] !== 255 ? " " + c[t * 4 + 3] : ""}`;
    lines.push(line);
  }
  return encoder.encode(lines.join("\n") + "\n");
}

/**
 * 3MF package with a single object. Explicit OpenSCAD colours are written as
 * base materials so slicers that understand them can show / map them.
 */
export function write3mf(mesh: Mesh, opts: { title?: string } = {}): Uint8Array {
  const m = weldVertices(mesh);
  const p = m.positions, idx = m.indices, c = m.colors;

  // Collect distinct colours (default colour counts as one material too, so
  // every triangle gets a valid property index when any colour is present).
  const materialIndex = new Map<string, number>();
  const materials: string[] = [];
  let triMaterial: Int32Array | undefined;
  let usesColor = false;
  if (c) {
    for (let i = 0; i < c.length; i += 4) {
      if (!isDefaultColor(c[i], c[i + 1], c[i + 2])) { usesColor = true; break; }
    }
  }
  if (c && usesColor) {
    triMaterial = new Int32Array(idx.length / 3);
    for (let t = 0; t < triMaterial.length; t++) {
      const hex = [c[t * 4], c[t * 4 + 1], c[t * 4 + 2], c[t * 4 + 3]]
        .map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      let mi = materialIndex.get(hex);
      if (mi === undefined) {
        mi = materials.length;
        materialIndex.set(hex, mi);
        materials.push(hex);
      }
      triMaterial[t] = mi;
    }
  }

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  parts.push(' <metadata name="Application">sketchpad-3d-model-mcp</metadata>\n');
  if (opts.title) parts.push(` <metadata name="Title">${escapeXml(opts.title)}</metadata>\n`);
  parts.push(" <resources>\n");
  const objectId = triMaterial ? 2 : 1;
  if (triMaterial) {
    parts.push('  <basematerials id="1">\n');
    materials.forEach((hex, i) => parts.push(`   <base name="Color ${i + 1}" displaycolor="#${hex}"/>\n`));
    parts.push("  </basematerials>\n");
    parts.push(`  <object id="${objectId}" type="model" pid="1" pindex="0">\n`);
  } else {
    parts.push(`  <object id="${objectId}" type="model">\n`);
  }
  parts.push("   <mesh>\n    <vertices>\n");
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`     <vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>\n`);
  }
  parts.push("    </vertices>\n    <triangles>\n");
  for (let t = 0; t < idx.length / 3; t++) {
    const mat = triMaterial ? ` pid="1" p1="${triMaterial[t]}"` : "";
    parts.push(`     <triangle v1="${idx[t * 3]}" v2="${idx[t * 3 + 1]}" v3="${idx[t * 3 + 2]}"${mat}/>\n`);
  }
  parts.push("    </triangles>\n   </mesh>\n  </object>\n </resources>\n");
  parts.push(` <build>\n  <item objectid="${objectId}"/>\n </build>\n</model>\n`);

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    "</Types>\n";
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    ' <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
    "</Relationships>\n";

  return createZip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rels) },
    { name: "3D/3dmodel.model", data: encoder.encode(parts.join("")) },
  ]);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!);
}
