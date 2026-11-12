import { describe, expect, it } from "vitest";
import { computeStats } from "../../src/geometry/stats.js";
import { encodeViewerMesh } from "../../src/viewer/viewer-server.js";
import { ViewerState } from "../../src/viewer/viewer-state.js";
import { formatMm, formatVolume, modelTitle, timeAgo } from "../../viewer/src/lib/format.js";
import { decodeViewerMesh } from "../../viewer/src/lib/mesh.js";
import { box, lShape } from "../helpers/meshes.js";

function roundTrip(mesh: ReturnType<typeof lShape>) {
  const { entry } = new ViewerState().addVersion({ mesh, stats: computeStats(mesh), title: "t" });
  const buf = encodeViewerMesh(entry);
  return decodeViewerMesh(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer);
}

describe("viewer page: mesh decoding", () => {
  it("reads what the server encodes, with explicit colours in linear space", () => {
    const mesh = lShape();
    const decoded = roundTrip(mesh);
    expect(decoded.triangles).toBe(36);
    // First triangle's first vertex, de-indexed.
    const v = mesh.indices[0] * 3;
    expect(Array.from(decoded.positions.subarray(0, 3))).toEqual(Array.from(mesh.positions.subarray(v, v + 3)));
    // Red bar (12 triangles), blue tower (12), then the uncoloured nub (12).
    expect(Array.from(decoded.colors.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(decoded.colors.subarray(12 * 9, 12 * 9 + 3))).toEqual([0, 0, 1]);
    expect(Array.from(decoded.defaultMask)).toEqual([...Array(24).fill(0), ...Array(12).fill(1)]);
  });

  it("marks every triangle of an uncoloured mesh for the colour picker", () => {
    const decoded = roundTrip(box([0, 0, 0], [1, 1, 1]));
    expect(decoded.triangles).toBe(12);
    expect(decoded.defaultMask.every((m) => m === 1)).toBe(true);
  });

  it("rejects anything that is not a viewer mesh", () => {
    expect(() => decodeViewerMesh(new TextEncoder().encode("<!DOCTYPE html>").buffer)).toThrow("bad mesh");
    expect(() => decodeViewerMesh(new ArrayBuffer(4))).toThrow("bad mesh");
  });
});

describe("viewer page: formatting", () => {
  it("formats dimensions, volume and titles like the sidebar shows them", () => {
    expect(formatMm(30)).toBe("30 mm");
    expect(formatMm(12.3456)).toBe("12.35 mm");
    expect(formatVolume(3375, false)).toBe("3.38 cm³");
    expect(formatVolume(800, true)).toBe("8.00 cm²");
    expect(modelTitle({ title: "Plate", is2D: true })).toBe("Plate (2D, shown 1 mm thick)");
    expect(modelTitle({ title: "Box", is2D: false })).toBe("Box");
  });

  it("describes how long ago a version was made", () => {
    const now = 10_000_000;
    expect(timeAgo(now - 5_000, now)).toBe("5s ago");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2h ago");
  });
});
