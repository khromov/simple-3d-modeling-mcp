/**
 * Golden-image style checks: render a known asymmetric model and assert where
 * things land. These would have caught the upside-down previews.
 */

import { describe, expect, it } from "vitest";
import { parseView } from "../../src/rendering/camera.js";
import { decodePng } from "../../src/rendering/png.js";
import { renderMesh, renderMeshPng, THEME } from "../../src/rendering/software-renderer.js";
import { bboxOf, centroid, isBlueish, isRedish } from "../helpers/image.js";
import { box, lShape } from "../helpers/meshes.js";

const SIZE = { width: 200, height: 200 };
const notBackground = (r: number, g: number, b: number) =>
  Math.abs(r - THEME.background[0]) + Math.abs(g - THEME.background[1]) + Math.abs(b - THEME.background[2]) > 30;

describe("software renderer orientation", () => {
  const mesh = lShape(); // red bar along X, blue 30 mm tower at +X, nub along +Y at -X

  it("front view: tower stands up on the right, bar along the bottom", () => {
    const img = renderMesh(mesh, { ...SIZE, camera: parseView("front"), projection: "orthographic", axes: false });
    const tower = bboxOf(img, isBlueish);
    const bar = bboxOf(img, isRedish);
    expect(tower.count).toBeGreaterThan(100);
    expect(tower.minY).toBeLessThan(bar.minY - 50); // tower rises above the bar (screen y grows downward)
    expect(tower.minX).toBeGreaterThan(img.width / 2); // on the right
    expect(tower.maxY).toBeGreaterThanOrEqual(bar.minY - 2); // tower reaches down to the bar (the bar hides its foot)
  });

  it("right view: tower on the left (nearest), nub extends to the right", () => {
    const img = renderMesh(mesh, { ...SIZE, camera: parseView("right"), projection: "orthographic", axes: false });
    const tower = bboxOf(img, isBlueish);
    expect(tower.maxX).toBeLessThan(img.width / 2 + 10);
    expect(tower.minY).toBeLessThan(img.height / 3);
    const all = bboxOf(img, notBackground);
    expect(all.maxX).toBeGreaterThan(img.width * 0.85); // the nub reaches the far right
  });

  it("top view: X to the right, Y up", () => {
    const img = renderMesh(mesh, { ...SIZE, camera: parseView("top"), projection: "orthographic", axes: false });
    const tower = centroid(img, isBlueish);
    const bar = centroid(img, isRedish);
    expect(tower.x).toBeGreaterThan(bar.x); // tower at +X end
    const all = bboxOf(img, notBackground);
    expect(all.minY).toBeLessThan(bar.y - 50); // nub extends towards +Y = up on screen
  });

  it("default perspective view keeps Z up", () => {
    const img = renderMesh(mesh, { ...SIZE, axes: false });
    const tower = bboxOf(img, isBlueish);
    const bar = centroid(img, isRedish);
    expect(tower.minY).toBeLessThan(bar.y - 30);
  });
});

describe("software renderer framing and quality", () => {
  it("auto-fits small and large models to the frame", () => {
    for (const s of [1, 1000]) {
      const img = renderMesh(box([0, 0, 0], [s, s, s]), { ...SIZE, axes: false });
      const bb = bboxOf(img, notBackground);
      const fill = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / SIZE.width;
      expect(fill).toBeGreaterThan(0.75);
      expect(bb.minX).toBeGreaterThan(0);
      expect(bb.maxX).toBeLessThan(SIZE.width - 1);
    }
  });

  it("honours explicit gimbal cameras", () => {
    const near = renderMesh(box([-5, -5, -5], [5, 5, 5]), { ...SIZE, camera: parseView("0,0,0,55,0,25,60"), axes: false });
    const far = renderMesh(box([-5, -5, -5], [5, 5, 5]), { ...SIZE, camera: parseView("0,0,0,55,0,25,240"), axes: false });
    expect(bboxOf(near, notBackground).count).toBeGreaterThan(bboxOf(far, notBackground).count * 4);
  });

  it("anti-aliases edges (intermediate colours exist)", () => {
    const img = renderMesh(box([0, 0, 0], [10, 10, 10], [255, 0, 0]), { ...SIZE, axes: false, edges: false }); // diagonal edges
    const colours = new Set<number>();
    for (let i = 0; i < img.rgba.length; i += 4) colours.add((img.rgba[i] << 16) | (img.rgba[i + 1] << 8) | img.rgba[i + 2]);
    expect(colours.size).toBeGreaterThan(3);
  });

  it("uses mesh colours and the model colour for uncoloured faces", () => {
    const img = renderMesh(lShape(), { ...SIZE, axes: false });
    expect(bboxOf(img, isRedish).count).toBeGreaterThan(50);
    expect(bboxOf(img, (r, g, b) => r > 150 && g > 60 && g < 180 && b < 60).count).toBeGreaterThan(20); // orange nub
  });

  it("draws axes and labels, and encodes a PNG", () => {
    const plain = renderMesh(box([0, 0, 0], [1, 1, 1]), { ...SIZE, axes: false });
    const decorated = renderMesh(box([0, 0, 0], [1, 1, 1]), { ...SIZE, axes: true, label: "FRONT" });
    expect(Buffer.compare(Buffer.from(plain.rgba), Buffer.from(decorated.rgba))).not.toBe(0);
    const png = renderMeshPng(box([0, 0, 0], [1, 1, 1]), { width: 64, height: 48 });
    const decoded = decodePng(png);
    expect([decoded.width, decoded.height]).toEqual([64, 48]);
  });

  it("renders an empty mesh as background", () => {
    const img = renderMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) }, { width: 8, height: 8, axes: false });
    expect(Array.from(img.rgba.subarray(0, 3))).toEqual(THEME.background);
  });
});
