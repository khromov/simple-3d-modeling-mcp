import { describe, expect, it } from "vitest";
import { applyMat, gimbalMatrix, lookAtMatrix, parseView, PRESET_VIEWS, resolvePreset, turntableAngles } from "../../src/rendering/camera.js";

const round = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

describe("parseView", () => {
  it("defaults to the auto-framed OpenSCAD default view", () => {
    expect(parseView()).toEqual({ kind: "fit", rot: [55, 0, 25] });
  });

  it("accepts presets and aliases, case-insensitively", () => {
    expect(parseView("Front")).toEqual({ kind: "fit", rot: [90, 0, 0] });
    expect(parseView("iso")).toEqual({ kind: "fit", rot: [...PRESET_VIEWS.perspective] });
    expect(resolvePreset("isometric")).toBe("perspective");
  });

  it("accepts rotations, gimbal and vector cameras", () => {
    expect(parseView("30, 0, 45")).toEqual({ kind: "fit", rot: [30, 0, 45] });
    expect(parseView("1,2,3,55,0,25,140")).toEqual({ kind: "gimbal", translate: [1, 2, 3], rot: [55, 0, 25], distance: 140 });
    expect(parseView("100,100,100,0,0,0")).toEqual({ kind: "vector", eye: [100, 100, 100], center: [0, 0, 0] });
  });

  it("rejects garbage with a helpful message", () => {
    expect(() => parseView("sideways")).toThrow(/Use a preset/);
    expect(() => parseView("1,2")).toThrow(/2 numbers/);
  });
});

describe("gimbalMatrix (OpenSCAD conventions)", () => {
  // Eye space: +X right, +Y up, +Z towards the viewer.
  it("top view looks down -Z with +Y up", () => {
    const m = gimbalMatrix([0, 0, 0]);
    expect(round(applyMat(m, 1, 0, 0))).toEqual([1, 0, 0]);
    expect(round(applyMat(m, 0, 1, 0))).toEqual([0, 1, 0]);
  });

  it("front view shows +Z up and +X right, +Y going away", () => {
    const m = gimbalMatrix([90, 0, 0]);
    expect(round(applyMat(m, 0, 0, 1))).toEqual([0, 1, 0]);
    expect(round(applyMat(m, 1, 0, 0))).toEqual([1, 0, 0]);
    expect(round(applyMat(m, 0, 1, 0))).toEqual([0, 0, -1]);
  });

  it("right view shows +Y to the right and +X towards the viewer", () => {
    const m = gimbalMatrix([90, 0, 90]);
    expect(round(applyMat(m, 0, 1, 0))).toEqual([1, 0, 0]);
    expect(round(applyMat(m, 0, 0, 1))).toEqual([0, 1, 0]);
    expect(round(applyMat(m, 1, 0, 0))).toEqual([0, 0, 1]);
  });

  it("default view keeps +Z pointing up on screen", () => {
    const up = applyMat(gimbalMatrix([55, 0, 25]), 0, 0, 1);
    expect(up[1]).toBeGreaterThan(0.5);
  });

  it("lookAt points the camera at the centre with Z up", () => {
    const m = lookAtMatrix([0, -10, 0], [0, 0, 0]); // same as the front view
    expect(round(applyMat(m, 0, 0, 1))).toEqual([0, 1, 0]);
    expect(round(applyMat(m, 0, 1, 0))).toEqual([0, 0, -1]);
  });
});

describe("turntableAngles", () => {
  it("spans a full revolution at constant elevation", () => {
    expect(turntableAngles(4, 30)).toEqual([[30, 0, 0], [30, 0, 90], [30, 0, 180], [30, 0, 270]]);
  });
});
