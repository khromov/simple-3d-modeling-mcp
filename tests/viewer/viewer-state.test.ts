import { describe, expect, it } from "vitest";
import { computeStats } from "../../src/geometry/stats.js";
import { ViewerState } from "../../src/viewer/viewer-state.js";
import { box } from "../helpers/meshes.js";

const mesh = box([0, 0, 0], [1, 1, 1]);
const input = (title: string, key?: string) => ({ mesh, stats: computeStats(mesh), title, key });

describe("ViewerState", () => {
  it("starts empty", () => {
    const state = new ViewerState();
    expect(state.versions).toHaveLength(0);
    expect(state.latest).toBeUndefined();
  });

  it("adds versions with increasing numbers", () => {
    const state = new ViewerState();
    const a = state.addVersion(input("A")).entry;
    const b = state.addVersion(input("B")).entry;
    expect([a.version, b.version]).toEqual([1, 2]);
    expect(state.latest).toBe(b);
    expect(state.getVersion(1)?.title).toBe("A");
    expect(state.getHistory()).toEqual([
      { version: 1, title: "A", timestamp: a.timestamp },
      { version: 2, title: "B", timestamp: b.timestamp },
    ]);
  });

  it("does not add a duplicate when the same model is pushed again, but updates the title", () => {
    const state = new ViewerState();
    state.addVersion(input("Model", "k1"));
    const again = state.addVersion(input("Phone stand", "k1"));
    expect(again.added).toBe(false);
    expect(state.versions).toHaveLength(1);
    expect(state.latest?.title).toBe("Phone stand");
    expect(state.addVersion(input("Other", "k2")).added).toBe(true);
  });

  it("evicts the oldest versions beyond the limit", () => {
    const state = new ViewerState(3);
    for (let i = 0; i < 5; i++) state.addVersion(input(`v${i}`));
    expect(state.versions.map((v) => v.version)).toEqual([3, 4, 5]);
    expect(state.getVersion(1)).toBeUndefined();
  });
});
