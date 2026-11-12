import { describe, expect, it, vi } from "vitest";
import { prepareSource } from "../src/engine/source.js";
import type { Engine, MeshResult } from "../src/engine/types.js";
import { ModelService } from "../src/model-service.js";
import { box } from "./helpers/meshes.js";

function countingEngine(fail = false) {
  const computeMesh = vi.fn(async (): Promise<MeshResult> => {
    await new Promise((r) => setTimeout(r, 5));
    return fail
      ? { ok: false, is2D: false, log: { errors: ["ERROR: boom"], warnings: [], echo: [] }, timeMs: 1 }
      : { ok: true, mesh: box([0, 0, 0], [1, 2, 3]), is2D: false, log: { errors: [], warnings: [], echo: ["1"] }, timeMs: 1 };
  });
  return { engine: { name: "wasm", computeMesh } as unknown as Engine, computeMesh };
}

describe("ModelService", () => {
  it("caches by code and params", async () => {
    const { engine, computeMesh } = countingEngine();
    const svc = new ModelService(engine);
    const a = await svc.getModel(prepareSource({ code: "cube(1);" }));
    const b = await svc.getModel(prepareSource({ code: "cube(1);" }));
    expect(a.ok && b.ok).toBe(true);
    expect(b.ok && b.cached).toBe(true);
    expect(b.ok && b.model.stats.size).toEqual([1, 2, 3]);
    await svc.getModel(prepareSource({ code: "cube(1);" }), { x: 1 });
    expect(computeMesh).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent requests", async () => {
    const { engine, computeMesh } = countingEngine();
    const svc = new ModelService(engine);
    await Promise.all([1, 2, 3].map(() => svc.getModel(prepareSource({ code: "cube(2);" }))));
    expect(computeMesh).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const { engine, computeMesh } = countingEngine(true);
    const svc = new ModelService(engine);
    const r = await svc.getModel(prepareSource({ code: "x" }));
    expect(r.ok).toBe(false);
    await svc.getModel(prepareSource({ code: "x" }));
    expect(computeMesh).toHaveBeenCalledTimes(2);
  });

  it("evicts least-recently-used entries", async () => {
    const { engine, computeMesh } = countingEngine();
    const svc = new ModelService(engine, { maxEntries: 2 });
    for (const c of ["a", "b", "a", "c", "a"]) await svc.getModel(prepareSource({ code: c }));
    expect(svc.size).toBe(2);
    expect(computeMesh).toHaveBeenCalledTimes(3); // "a" stayed cached because it was recently used
  });
});
