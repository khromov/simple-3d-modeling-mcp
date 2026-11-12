import { describe, expect, it, vi } from "vitest";
import type { Engine, RunResult } from "../../src/engine/types.js";
import { prepareSource } from "../../src/engine/source.js";
import { decodePng, encodeApng, encodePng } from "../../src/rendering/png.js";
import { composeGrid, renderMultiView, renderPreview, renderTurntable } from "../../src/rendering/previews.js";
import { box, lShape } from "../helpers/meshes.js";

function fakeEngine(png: boolean, output?: Uint8Array): Engine {
  return {
    name: png ? "native" : "wasm",
    capabilities: { png, manifold: true, exportFormats: [] },
    run: vi.fn(),
    computeMesh: vi.fn(),
    exportFormat: vi.fn(),
    validate: vi.fn(),
    version: async () => "test",
    describe: async () => ({}),
    dispose: async () => {},
    renderPng: png
      ? vi.fn(async (): Promise<RunResult> => ({ ok: !!output, output, log: { errors: [], warnings: [], echo: [] }, exitCode: 0, timedOut: false, raw: [], timeMs: 1 }))
      : undefined,
  } as unknown as Engine;
}

const src = prepareSource({ code: "cube(1);" });

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
});

describe("previews", () => {
  it("uses the software renderer when the engine cannot render PNGs", async () => {
    const r = await renderPreview({ engine: fakeEngine(false), src, mesh: box([0, 0, 0], [1, 1, 1]) }, {
      camera: { kind: "fit", rot: [55, 0, 25] }, projection: "perspective", width: 64, height: 64,
    });
    expect(r.renderer).toBe("software");
    expect(decodePng(r.png).width).toBe(64);
  });

  it("uses OpenSCAD's renderer when available and falls back when it fails", async () => {
    const ok = fakeEngine(true, encodePng(new Uint8Array(64 * 64 * 4).fill(255), 64, 64));
    const r1 = await renderPreview({ engine: ok, src, mesh: box([0, 0, 0], [1, 1, 1]) }, {
      camera: { kind: "fit", rot: [0, 0, 0] }, projection: "orthographic", width: 64, height: 64,
    });
    expect(r1.renderer).toBe("openscad");

    const broken = fakeEngine(true, undefined);
    const r2 = await renderPreview({ engine: broken, src, mesh: box([0, 0, 0], [1, 1, 1]) }, {
      camera: { kind: "fit", rot: [0, 0, 0] }, projection: "orthographic", width: 64, height: 64,
    });
    expect(r2).toMatchObject({ renderer: "software", openscadFailed: true });
  });

  it("composes a labelled multi-view grid and describes the layout", async () => {
    const r = await renderMultiView({ engine: fakeEngine(false), src, mesh: lShape() }, {
      views: ["front", "right", "top", "perspective"], cellWidth: 128, cellHeight: 96,
    });
    const img = decodePng(r.png);
    expect([img.width, img.height]).toEqual([128 * 2 + 2, 96 * 2 + 2]);
    expect(r.layout).toBe("row 1 col 1: front (ortho); row 1 col 2: right (ortho); row 2 col 1: top (ortho); row 2 col 2: perspective");
  });

  it("lays out up to six cells in three columns", () => {
    const cell = { width: 10, height: 10, rgba: new Uint8Array(400).fill(255) };
    const img = decodePng(composeGrid(Array(5).fill(cell), ["a", "b", "c", "d", "e"], 10, 10));
    expect([img.width, img.height]).toEqual([34, 22]);
  });

  it("renders a turntable APNG with the requested frame count", () => {
    const apng = Buffer.from(renderTurntable(lShape(), { frames: 6, width: 64, height: 64 }));
    expect(apng.readUInt32BE(apng.indexOf("acTL") + 4)).toBe(6);
  });
});
