import { describe, expect, it } from "vitest";
import { textWidth } from "../../src/rendering/bitmap-font.js";
import { ApngWriter, decodePng, encodeApng, encodePng } from "../../src/rendering/png.js";
import { composeGrid, renderMultiView, renderTurntable, TurntableTooLargeError } from "../../src/rendering/previews.js";
import { bboxOf, centroid, type Pred } from "../helpers/image.js";
import { box, lShape, merge } from "../helpers/meshes.js";

const red: Pred = (r, g, b) => r > g + 60 && r > b + 60;
const blue: Pred = (r, g, b) => b > r + 40 && b > g + 40;

describe("PNG codec", () => {
  it("round-trips RGB images and writes APNG frames", () => {
    const rgba = new Uint8Array(5 * 3 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
    const back = decodePng(encodePng(rgba, 5, 3));
    expect(back.width).toBe(5);
    expect(Array.from(back.rgba)).toEqual(Array.from(rgba));
    const apng = Buffer.from(encodeApng([rgba, rgba, rgba], 5, 3, 100));
    expect(apng.includes(Buffer.from("acTL"))).toBe(true);
    expect(apng.readUInt32BE(apng.indexOf("acTL") + 4)).toBe(3);
    expect(decodePng(apng).width).toBe(5); // first frame is a normal PNG
  });

  it("streams APNG frames and reports the file size as it grows", () => {
    const rgba = new Uint8Array(5 * 3 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
    const writer = new ApngWriter(5, 3, 2, 100);
    writer.addFrame(rgba);
    const afterOne = writer.size;
    writer.addFrame(rgba);
    expect(writer.size).toBeGreaterThan(afterOne);
    const bytes = writer.finish();
    expect(bytes.length).toBe(writer.size);
    expect(Buffer.from(bytes).equals(Buffer.from(encodeApng([rgba, rgba], 5, 3, 100)))).toBe(true);
    expect(() => new ApngWriter(5, 3, 2, 100).finish()).toThrow(/0 of its 2 frames/);
  });
});

describe("previews", () => {
  it("composes a labelled multi-view grid and describes the layout", () => {
    const r = renderMultiView(lShape(), { views: ["front", "right", "top", "perspective"], cellWidth: 128, cellHeight: 96 });
    const img = decodePng(r.png);
    expect([img.width, img.height]).toEqual([128 * 2 + 2, 96 * 2 + 2]);
    expect(r.layout).toBe("row 1 col 1: front (ortho); row 1 col 2: right (ortho); row 2 col 1: top (ortho); row 2 col 2: perspective");
  });

  it("keeps the model out from under each cell's title", () => {
    // A tall tower in 128 px cells used to run up under "FRONT (ORTHO)".
    const tower = box([0, 0, 0], [10, 10, 40]);
    const img = decodePng(renderMultiView(tower, { views: ["front", "right"], cellWidth: 128, cellHeight: 128 }).png);
    // The title "FRONT (ORTHO)" / "RIGHT (ORTHO)" sits at (8, 8): 7 px tall at this cell size.
    const titleW = 8 + textWidth("front (ortho)", 1), titleH = 8 + 7;
    for (const cell of [0, 1]) {
      const x0 = cell * 130; // 128 px cells with a 2 px gap
      let model = 0;
      for (let y = 0; y < titleH; y++) {
        for (let x = x0; x < x0 + titleW; x++) {
          const i = (y * img.width + x) * 4;
          if (img.rgba[i] > 60 && img.rgba[i] > img.rgba[i + 1] + 30 && img.rgba[i + 2] < 60) model++;
        }
      }
      expect(model, `cell ${cell}`).toBe(0);
    }
  });

  it("lays out up to six cells in three columns", () => {
    const cell = { width: 10, height: 10, rgba: new Uint8Array(400).fill(255) };
    const img = decodePng(composeGrid(Array(5).fill(cell), ["a", "b", "c", "d", "e"], 10, 10));
    expect([img.width, img.height]).toEqual([34, 22]);
  });

  it("views the underside, upright, when the elevation is over 90", () => {
    // Blue slab at the bottom, red slab on top.
    const tower = merge(box([0, 0, 0], [10, 10, 2], [0, 0, 255]), box([0, 0, 2], [10, 10, 18]), box([0, 0, 18], [10, 10, 20], [255, 0, 0]));
    const firstFrame = (elevation: number) => decodePng(renderTurntable(tower, { frames: 4, width: 128, height: 128, elevation }));
    const above = firstFrame(55), below = firstFrame(125);
    expect(bboxOf(above, red).count).toBeGreaterThan(bboxOf(below, red).count); // the red top face, from above
    expect(bboxOf(below, blue).count).toBeGreaterThan(bboxOf(above, blue).count); // the blue bottom face, from below
    expect(centroid(below, red).y).toBeLessThan(centroid(below, blue).y); // still the right way up
  });

  it("stops as soon as a turntable passes maxBytes, with a size estimate", () => {
    const opts = { frames: 24, width: 128, height: 128 };
    let error: unknown;
    try {
      renderTurntable(lShape(), { ...opts, maxBytes: 20_000 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TurntableTooLargeError);
    const { framesRendered, estimatedBytes } = error as TurntableTooLargeError;
    expect(framesRendered).toBeLessThan(opts.frames);
    const full = renderTurntable(lShape(), opts).length;
    expect(full).toBeGreaterThan(20_000);
    expect(Math.abs(estimatedBytes - full) / full).toBeLessThan(0.25);
  });

  it("renders a turntable APNG with the requested frame count", () => {
    const apng = Buffer.from(renderTurntable(lShape(), { frames: 6, width: 64, height: 64 }));
    expect(apng.readUInt32BE(apng.indexOf("acTL") + 4)).toBe(6);
  });
});
