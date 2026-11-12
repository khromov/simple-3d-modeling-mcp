/**
 * What src/viewer/viewer-server.ts sends over the WebSocket. The mesh itself is
 * fetched from GET /mesh/:version (see mesh.ts) and its source from GET
 * /source/:version; downloads are GET /model/:version.(stl|3mf) and POST
 * /open-in-slicer/:version?slicer=…
 */

export interface HistoryEntry {
  version: number;
  title: string;
  timestamp: number;
}

/** The subset of the server's MeshStats the page shows. */
export interface ModelStats {
  triangles: number;
  size: [number, number, number];
  /** mm³ (for 2D models: the area in mm² of the 1 mm thick extrusion). */
  volume: number;
}

export interface ModelUpdate extends HistoryEntry {
  type: "model-update";
  is2D: boolean;
  stats: ModelStats;
}

export interface ModelHistory {
  type: "model-history";
  versions: HistoryEntry[];
}

export type ServerMessage = ModelUpdate | ModelHistory;

/** GET /source/:version (404 when the version has none); ModelSource in src/viewer/viewer-state.ts. */
export interface ModelSource {
  /** The main file's code (included and used files are not part of it). */
  code: string;
  /** File name, when the model was rendered from a file on disk. */
  file?: string;
  /** Variable overrides (`name=value`) applied on top of the code with -D. */
  params?: string[];
}

export interface RequestModel {
  type: "request-model";
  version: number;
}
