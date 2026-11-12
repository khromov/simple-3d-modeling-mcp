import type { Mesh } from "../geometry/mesh.js";
import type { MeshStats } from "../geometry/stats.js";

export interface ModelVersion {
  version: number;
  title: string;
  timestamp: number;
  mesh: Mesh;
  stats: MeshStats;
  is2D: boolean;
  /** Identifies the source+params that produced the mesh (dedupes repeat pushes). */
  key?: string;
}

export interface ModelHistoryEntry {
  version: number;
  title: string;
  timestamp: number;
}

export interface AddVersionInput {
  mesh: Mesh;
  title: string;
  stats: MeshStats;
  is2D?: boolean;
  key?: string;
}

export class ViewerState {
  private _versions: ModelVersion[] = [];
  private _nextVersion = 1;
  private readonly _maxVersions: number;

  constructor(maxVersions = 30) {
    this._maxVersions = maxVersions;
  }

  get versions(): readonly ModelVersion[] {
    return this._versions;
  }

  get latest(): ModelVersion | undefined {
    return this._versions.at(-1);
  }

  /** Adds a version; returns the existing latest entry if it is the same model. */
  addVersion(input: AddVersionInput): { entry: ModelVersion; added: boolean } {
    const latest = this.latest;
    if (latest && input.key && latest.key === input.key) {
      if (input.title && input.title !== latest.title) latest.title = input.title;
      return { entry: latest, added: false };
    }
    const entry: ModelVersion = {
      version: this._nextVersion++,
      title: input.title,
      timestamp: Date.now(),
      mesh: input.mesh,
      stats: input.stats,
      is2D: input.is2D ?? false,
      key: input.key,
    };
    this._versions.push(entry);
    while (this._versions.length > this._maxVersions) this._versions.shift();
    return { entry, added: true };
  }

  getVersion(version: number): ModelVersion | undefined {
    return this._versions.find((v) => v.version === version);
  }

  getHistory(): ModelHistoryEntry[] {
    return this._versions.map(({ version, title, timestamp }) => ({ version, title, timestamp }));
  }
}
