/**
 * Evaluates models through the engine and caches the resulting meshes, so a
 * render followed by a multiview, a turntable, a viewer push and an export of
 * the same code costs one OpenSCAD evaluation instead of five.
 */

import { createHash } from "node:crypto";
import type { Engine, EngineLog, Params, PreparedSource } from "./engine/types.js";
import { stableParams } from "./engine/params.js";
import { meshByteSize, type Mesh } from "./geometry/mesh.js";
import { computeStats, type MeshStats } from "./geometry/stats.js";

export interface Model {
  key: string;
  mesh: Mesh;
  stats: MeshStats;
  is2D: boolean;
  log: EngineLog;
  /** OpenSCAD evaluation time of the original (uncached) run. */
  timeMs: number;
}

export type ModelOutcome =
  | { ok: true; model: Model; cached: boolean }
  | { ok: false; log: EngineLog; is2D: boolean };

export interface ModelServiceOptions {
  maxEntries?: number;
  maxBytes?: number;
}

export class ModelService {
  private readonly cache = new Map<string, { model: Model; bytes: number }>();
  private readonly inflight = new Map<string, Promise<ModelOutcome>>();
  private totalBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(readonly engine: Engine, opts: ModelServiceOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 16;
    this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
  }

  keyFor(src: PreparedSource, params?: Params): string {
    return createHash("sha256").update(this.engine.name).update("\0").update(src.hash).update("\0").update(stableParams(params)).digest("hex");
  }

  async getModel(src: PreparedSource, params?: Params): Promise<ModelOutcome> {
    const key = this.keyFor(src, params);
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { ok: true, model: hit.model, cached: true };
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.evaluate(key, src, params).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async evaluate(key: string, src: PreparedSource, params?: Params): Promise<ModelOutcome> {
    const r = await this.engine.computeMesh(src, params);
    if (!r.ok || !r.mesh) return { ok: false, log: r.log, is2D: r.is2D };
    const model: Model = { key, mesh: r.mesh, stats: computeStats(r.mesh), is2D: r.is2D, log: r.log, timeMs: r.timeMs };
    this.store(key, model);
    return { ok: true, model, cached: false };
  }

  private store(key: string, model: Model): void {
    const bytes = meshByteSize(model.mesh);
    this.cache.set(key, { model, bytes });
    this.totalBytes += bytes;
    while (this.cache.size > this.maxEntries || (this.totalBytes > this.maxBytes && this.cache.size > 1)) {
      const oldest = this.cache.keys().next().value as string;
      this.totalBytes -= this.cache.get(oldest)!.bytes;
      this.cache.delete(oldest);
    }
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }
}
