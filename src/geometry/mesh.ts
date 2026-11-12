/**
 * Indexed triangle mesh used throughout the server (previews, viewer, exports).
 */

export interface Mesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /**
   * RGBA per triangle (4 bytes each), or undefined when the source carried no
   * colour information. Faces OpenSCAD left uncoloured use {@link DEFAULT_FACE_COLOR}.
   */
  colors?: Uint8Array;
}

/** Colour OpenSCAD assigns to geometry without an explicit color() (#F9D72C). */
export const DEFAULT_FACE_COLOR: readonly [number, number, number] = [249, 215, 44];
/** Colour OpenSCAD gives faces cut by difference() when they have no color() (#9DCB51). */
export const DEFAULT_CUT_COLOR: readonly [number, number, number] = [157, 203, 81];

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** True for OpenSCAD's implicit colours, i.e. faces the user did not colour. */
export function isDefaultColor(r: number, g: number, b: number): boolean {
  return (
    (r === DEFAULT_FACE_COLOR[0] && g === DEFAULT_FACE_COLOR[1] && b === DEFAULT_FACE_COLOR[2]) ||
    (r === DEFAULT_CUT_COLOR[0] && g === DEFAULT_CUT_COLOR[1] && b === DEFAULT_CUT_COLOR[2])
  );
}

/** True when at least one face has an explicit (non-default) colour. */
export function hasExplicitColors(mesh: Mesh): boolean {
  const c = mesh.colors;
  if (!c) return false;
  for (let i = 0; i < c.length; i += 4) {
    if (!isDefaultColor(c[i], c[i + 1], c[i + 2])) return true;
  }
  return false;
}

/** Approximate memory footprint, used for cache accounting. */
export function meshByteSize(mesh: Mesh): number {
  return mesh.positions.byteLength + mesh.indices.byteLength + (mesh.colors?.byteLength ?? 0);
}

/**
 * Merge vertices with bit-identical coordinates. STL input stores every
 * triangle corner separately; slicers and 3MF consumers want shared vertices.
 */
export function weldVertices(mesh: Mesh): Mesh {
  const { positions, indices } = mesh;
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const map = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const out: number[] = [];
  for (let v = 0; v < remap.length; v++) {
    const key = `${bits[v * 3]},${bits[v * 3 + 1]},${bits[v * 3 + 2]}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = out.length / 3;
      map.set(key, idx);
      out.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    remap[v] = idx;
  }
  const newIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) newIndices[i] = remap[indices[i]];
  return { positions: Float32Array.from(out), indices: newIndices, colors: mesh.colors };
}
