/**
 * Decodes the binary mesh from GET /mesh/:version (encodeViewerMesh in
 * src/viewer/viewer-server.ts): "S3DM", format version, triangle count, flags
 * (bit 0: has colours), positions (f32 × 9 per triangle), then sRGB colours
 * (u8 × 4 per triangle, alpha 0 = OpenSCAD's default colour).
 */

export interface ViewerMesh {
  triangles: number;
  /** Non-indexed triangle vertices, 9 floats per triangle. */
  positions: Float32Array;
  /** Linear-space RGB per vertex, 9 floats per triangle (0 where `defaultMask` is set). */
  colors: Float32Array;
  /** One byte per triangle: 1 = no explicit colour, painted with the model colour picker. */
  defaultMask: Uint8Array;
}

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

export function decodeViewerMesh(buf: ArrayBuffer): ViewerMesh {
  const dv = new DataView(buf);
  if (buf.byteLength < 16 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "S3DM") {
    throw new Error("bad mesh");
  }
  const n = dv.getUint32(8, true);
  const hasColors = (dv.getUint32(12, true) & 1) === 1;
  const positions = new Float32Array(buf, 16, n * 9);
  const colors = new Float32Array(n * 9);
  const defaultMask = new Uint8Array(n);
  const rgba = hasColors ? new Uint8Array(buf, 16 + n * 36, n * 4) : null;
  for (let t = 0; t < n; t++) {
    if (!rgba || rgba[t * 4 + 3] === 0) {
      defaultMask[t] = 1;
      continue;
    }
    const r = SRGB_TO_LINEAR[rgba[t * 4]], g = SRGB_TO_LINEAR[rgba[t * 4 + 1]], b = SRGB_TO_LINEAR[rgba[t * 4 + 2]];
    for (let k = 0; k < 3; k++) {
      colors[t * 9 + k * 3] = r;
      colors[t * 9 + k * 3 + 1] = g;
      colors[t * 9 + k * 3 + 2] = b;
    }
  }
  return { triangles: n, positions, colors, defaultMask };
}
