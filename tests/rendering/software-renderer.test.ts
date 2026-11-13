/**
 * Golden-image style checks: render a known asymmetric model and assert where
 * things land. These would have caught the upside-down previews.
 */

import { describe, expect, it } from "vitest";
import { parseView } from "../../src/rendering/camera.js";
import { decodePng } from "../../src/rendering/png.js";
import { renderMesh, renderMeshPng, THEME } from "../../src/rendering/software-renderer.js";
import { bboxOf, centroid, isBlueish, isRedish, type Pred } from "../helpers/image.js";
import type { Mesh } from "../../src/geometry/mesh.js";
import type { RenderOptions } from "../../src/rendering/software-renderer.js";
import { box, cylinder, lShape, merge } from "../helpers/meshes.js";

const SIZE = { width: 200, height: 200 };
const notBackground = (r: number, g: number, b: number) =>
  Math.abs(r - THEME.background[0]) + Math.abs(g - THEME.background[1]) + Math.abs(b - THEME.background[2]) > 30;

/** Model pixels that outlines darken: the same render with and without edges, compared. */
function outlined(mesh: Mesh, opts: RenderOptions): { pixels: number; fraction: number } {
  const lines = renderMesh(mesh, { ...opts, axes: false });
  const plain = renderMesh(mesh, { ...opts, axes: false, edges: false });
  let model = 0, pixels = 0;
  for (let i = 0; i < plain.rgba.length; i += 4) {
    if (!notBackground(plain.rgba[i], plain.rgba[i + 1], plain.rgba[i + 2])) continue;
    model++;
    if (lines.rgba[i] < plain.rgba[i] * 0.8) pixels++;
  }
  return { pixels, fraction: pixels / model };
}

describe("software renderer outlines", () => {
  it("does not outline the facets of a finely tessellated curve", () => {
    // 0.6° between neighbouring facets: they used to be marked as steps, hatching the whole side
    // (66% of the cylinder outlined). It should show only the silhouette and rims, as a 5° cylinder does.
    for (const view of [{ camera: parseView("iso"), projection: "perspective" as const }, { camera: parseView("front"), projection: "orthographic" as const }]) {
      const reference = outlined(cylinder(10, 30, 72), { ...SIZE, ...view }).fraction;
      expect(outlined(cylinder(10, 30, 600), { ...SIZE, ...view }).fraction).toBeLessThan(reference * 1.1);
    }
  });

  it("still outlines a small step between parallel faces", () => {
    // A 0.3 mm pad on a plate, seen from above: far below the coarse depth test, so only the step test finds it.
    const view = { ...SIZE, camera: parseView("top"), projection: "orthographic" as const };
    const plate = box([0, 0, 0], [40, 40, 2]);
    const withPad = outlined(merge(plate, box([10, 10, 2], [30, 30, 2.3])), view).pixels;
    expect(withPad - outlined(plate, view).pixels).toBeGreaterThan(200);
  });
});

const luminance = (d: Uint8Array, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

describe("software renderer dark colours", () => {
  const BACKGROUND = luminance(Uint8Array.from(THEME.background), 0);
  /** Luminance of every model pixel, and how many outline pixels are lighter than the face under them. */
  function faces(color: [number, number, number]) {
    const plain = renderMesh(box([0, 0, 0], [10, 10, 10], color), { ...SIZE, axes: false, edges: false });
    const lined = renderMesh(box([0, 0, 0], [10, 10, 10], color), { ...SIZE, axes: false });
    let min = Infinity, max = -Infinity, lighterEdges = 0;
    for (let i = 0; i < plain.rgba.length; i += 4) {
      if (!notBackground(plain.rgba[i], plain.rgba[i + 1], plain.rgba[i + 2])) continue;
      const l = luminance(plain.rgba, i);
      min = Math.min(min, l); max = Math.max(max, l);
      if (luminance(lined.rgba, i) > l + 10) lighterEdges++;
    }
    return { min, max, lighterEdges };
  }

  it("keeps black faces apart from each other and from the background", () => {
    // Black used to render at luminance 0–12, below the background, with outlines that vanished.
    const black = faces([0, 0, 0]);
    expect(black.min).toBeGreaterThan(BACKGROUND + 10);
    expect(black.max - black.min).toBeGreaterThan(30);
    expect(black.lighterEdges).toBeGreaterThan(100);
  });

  it("keeps the faces of a dark navy part distinguishable", () => {
    // Its three faces used to be within 2 levels of each other.
    const navy = faces([38, 38, 77]);
    expect(navy.max - navy.min).toBeGreaterThan(10);
  });
});

describe("software renderer overlays", () => {
  const isAxis: Pred = (r, g, b) => THEME.axes.some(([ar, ag, ab]) => Math.abs(r - ar) + Math.abs(g - ag) + Math.abs(b - ab) < 40);
  // The gizmo test uses a magenta cube: no axis colour, nor its blend with the background, looks like it.
  const isMagenta: Pred = (r, g, b) => r > 60 && b > 60 && g < r / 2 && Math.abs(r - b) < 40;
  const isOrange: Pred = (r, g, b) => r > 60 && r > g + 30 && b < 60; // shades of the default model colour
  const front = { camera: parseView("front"), projection: "orthographic" as const };
  /** Model pixels inside a rectangle. */
  function modelIn(img: ReturnType<typeof renderMesh>, x0: number, y0: number, x1: number, y1: number, isModel: Pred = isOrange): number {
    let n = 0;
    for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) {
        const i = (y * img.width + x) * 4;
        if (isModel(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) n++;
      }
    }
    return n;
  }

  it("leaves the gizmo out of images too small to read it", () => {
    const cube = box([0, 0, 0], [10, 10, 10]);
    const opts = { width: 64, height: 64 };
    expect(Buffer.from(renderMesh(cube, { ...opts, axes: true }).rgba).equals(Buffer.from(renderMesh(cube, { ...opts, axes: false }).rgba))).toBe(true);
  });

  it("keeps the model clear of the gizmo", () => {
    // Seen from the front, a cube fills the frame and used to sit under the gizmo's corner.
    for (const size of [128, 256, 512]) {
      const img = renderMesh(box([0, 0, 0], [10, 10, 10], [255, 0, 255]), { width: size, height: size, ...front, edges: false });
      const gizmo = bboxOf(img, isAxis);
      expect(gizmo.count, `${size} px`).toBeGreaterThan(0);
      expect(modelIn(img, gizmo.minX, gizmo.minY, gizmo.maxX, gizmo.maxY, isMagenta), `${size} px`).toBe(0);
    }
  });

  it("keeps the gizmo, letters included, inside the image", () => {
    // In the bottom view +Y points down, so its letter is the one closest to the bottom edge.
    const img = renderMesh(box([0, 0, 0], [10, 10, 10]), { width: 256, height: 256, camera: parseView("bottom"), projection: "orthographic" });
    const gizmo = bboxOf(img, isAxis);
    expect(gizmo.maxY).toBeLessThan(256 - 2);
    expect(gizmo.minX).toBeGreaterThan(1);
  });

  it("keeps the model clear of reserved areas, such as a title", () => {
    const tall = box([0, 0, 0], [10, 10, 40]);
    const opts = { width: 128, height: 128, ...front, axes: false };
    expect(modelIn(renderMesh(tall, opts), 0, 0, 79, 19)).toBeGreaterThan(0); // the tower reaches the top-left corner…
    expect(modelIn(renderMesh(tall, { ...opts, keepClear: [{ x: 0, y: 0, width: 80, height: 20 }] }), 0, 0, 79, 19)).toBe(0); // …unless it is kept clear
  });

  it("leaves the framing alone when nothing overlaps", () => {
    const cube = box([0, 0, 0], [10, 10, 10]);
    const opts = { ...SIZE, ...front, axes: false };
    const corner = { x: 196, y: 196, width: 4, height: 4 };
    expect(Buffer.from(renderMesh(cube, { ...opts, keepClear: [corner] }).rgba).equals(Buffer.from(renderMesh(cube, opts).rgba))).toBe(true);
  });
});

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
