import type { Mesh } from "../geometry/mesh.js";
import type { MeshStats } from "../geometry/stats.js";

/** The OpenSCAD source a version was rendered from, shown read-only in the viewer. */
export interface ModelSource {
  /** The main file's code (included and used files are not part of it). */
  code: string;
  /** File name, when the model was rendered from a file on disk. */
  file?: string;
  /** Variable overrides (`name=value`) applied on top of the code with -D. */
  params?: string[];
}

export interface ModelVersion {
  version: number;
  title: string;
  timestamp: number;
  mesh: Mesh;
  stats: MeshStats;
  is2D: boolean;
  /** Identifies the source+params that produced the mesh (dedupes repeat pushes). */
  key?: string;
  source?: ModelSource;
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
  source?: ModelSource;
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
      source: input.source,
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
