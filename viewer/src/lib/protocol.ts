/**
 * What src/viewer/viewer-server.ts sends over the WebSocket. The mesh itself is
 * fetched from GET /mesh/:version (see mesh.ts); downloads are GET
 * /model/:version.(stl|3mf) and POST /open-in-slicer/:version?slicer=…
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

export interface RequestModel {
  type: "request-model";
  version: number;
}
