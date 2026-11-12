import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { hasExplicitColors, isDefaultColor, weldVertices } from "../../src/geometry/mesh.js";
import { isBinaryStl, parseOff, parseStl } from "../../src/geometry/parse.js";
import { computeStats, formatStats } from "../../src/geometry/stats.js";
import { write3mf, writeBinaryStl, writeObj, writeOff } from "../../src/geometry/writers.js";
import { box, merge } from "../helpers/meshes.js";

const enc = new TextEncoder();

/** Reads entries from a ZIP produced by createZip (deflate only). */
function unzip(bytes: Uint8Array): Map<string, string> {
  const buf = Buffer.from(bytes);
  const out = new Map<string, string>();
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const csize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const start = off + 30 + nameLen + extra;
    out.set(name, inflateRawSync(buf.subarray(start, start + csize)).toString("utf8"));
    off = start + csize;
  }
  return out;
}

describe("parseOff", () => {
  it("parses OpenSCAD OFF output with per-face colours", () => {
    const off = "OFF 4 2 0\n0 0 0\n10 0 0\n10 10 0\n0 10 0\n3 0 1 2 255 0 0\n3 0 2 3 249 215 44\n";
    const mesh = parseOff(enc.encode(off));
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(mesh.colors!)).toEqual([255, 0, 0, 255, 249, 215, 44, 255]);
    expect(hasExplicitColors(mesh)).toBe(true);
  });

  it("handles a header on its own line, comments, no colours, and fan-triangulates polygons", () => {
    const off = "OFF\n# comment\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n";
    const mesh = parseOff(enc.encode(off));
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.colors).toBeUndefined();
  });

  it("accepts float colours in 0..1", () => {
    const mesh = parseOff(enc.encode("OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 1.0 0.5 0.0 1.0\n"));
    expect(Array.from(mesh.colors!)).toEqual([255, 128, 0, 255]);
  });

  it("rejects non-OFF input", () => {
    expect(() => parseOff(enc.encode("solid x"))).toThrow(/Not an OFF/);
  });
});

describe("STL", () => {
  it("round-trips through the binary writer and parser", () => {
    const cube = box([0, 0, 0], [10, 20, 30]);
    const stl = writeBinaryStl(cube);
    expect(stl.length).toBe(84 + 12 * 50);
    expect(isBinaryStl(stl)).toBe(true);
    const back = parseStl(stl);
    expect(back.indices.length).toBe(36);
    expect(computeStats(back).volume).toBeCloseTo(6000, 3);
  });

  it("parses ASCII STL", () => {
    const ascii =
      "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    expect(isBinaryStl(enc.encode(ascii))).toBe(false);
    const mesh = parseStl(enc.encode(ascii));
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("treats a binary STL whose header starts with 'solid' as binary", () => {
    const stl = writeBinaryStl(box([0, 0, 0], [1, 1, 1]), "solid but binary");
    expect(isBinaryStl(stl)).toBe(true);
  });
});

describe("computeStats", () => {
  it("computes bounds, volume, area and explicit colours", () => {
    const mesh = merge(box([0, 0, 0], [10, 10, 10], [255, 0, 0]), box([20, 0, 0], [22, 2, 2]));
    const s = computeStats(mesh);
    expect(s.min).toEqual([0, 0, 0]);
    expect(s.max).toEqual([22, 10, 10]);
    expect(s.size).toEqual([22, 10, 10]);
    expect(s.volume).toBeCloseTo(1008, 3);
    expect(s.area).toBeCloseTo(600 + 24, 3);
    expect(s.triangles).toBe(24);
    expect(s.colors).toEqual(["#ff0000"]);
  });

  it("formats sizes for the model to read", () => {
    const text = formatStats(computeStats(box([-20, -20, 0], [20, 20, 25])));
    expect(text).toContain("Size: 40 × 40 × 25 mm");
    expect(text).toContain("Volume: 40.00 cm³");
    expect(text).toContain("12 triangles");
  });

  it("treats OpenSCAD's implicit colours as default", () => {
    expect(isDefaultColor(249, 215, 44)).toBe(true);
    expect(isDefaultColor(157, 203, 81)).toBe(true); // difference() cut faces
    expect(isDefaultColor(255, 0, 0)).toBe(false);
  });
});

describe("writers", () => {
  it("welds duplicate vertices", () => {
    const stlMesh = parseStl(writeBinaryStl(box([0, 0, 0], [1, 1, 1])));
    expect(stlMesh.positions.length / 3).toBe(36);
    expect(weldVertices(stlMesh).positions.length / 3).toBe(8);
  });

  it("writes a valid 3MF package with colour materials", () => {
    const mesh = merge(box([0, 0, 0], [10, 10, 10], [255, 0, 0]), box([20, 0, 0], [25, 5, 5]));
    const files = unzip(write3mf(mesh, { title: "Two <boxes>" }));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    const model = files.get("3D/3dmodel.model")!;
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain("Two &lt;boxes&gt;");
    expect(model).toContain('displaycolor="#FF0000FF"');
    expect(model.match(/<vertex /g)).toHaveLength(16);
    expect(model.match(/<triangle /g)).toHaveLength(24);
    expect(model).toMatch(/<triangle [^>]*pid="1" p1="\d+"/);
  });

  it("omits materials when there are no explicit colours", () => {
    const model = unzip(write3mf(box([0, 0, 0], [1, 1, 1]))).get("3D/3dmodel.model")!;
    expect(model).not.toContain("basematerials");
  });

  it("writes OBJ and OFF", () => {
    const obj = new TextDecoder().decode(writeObj(box([0, 0, 0], [1, 1, 1])));
    expect(obj.match(/^v /gm)).toHaveLength(8);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    const off = writeOff(box([0, 0, 0], [1, 1, 1], [0, 128, 255]));
    const back = parseOff(off);
    expect(back.indices.length).toBe(36);
    expect(Array.from(back.colors!.subarray(0, 4))).toEqual([0, 128, 255, 255]);
  });
});
