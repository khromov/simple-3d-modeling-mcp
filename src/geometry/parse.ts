/**
 * Parsers for the mesh formats OpenSCAD emits: OFF (indexed, with per-face
 * colours when using the Manifold backend) and STL (binary or ASCII).
 */

import type { Mesh } from "./mesh.js";

const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// OFF
// ---------------------------------------------------------------------------

export function parseOff(input: Uint8Array): Mesh {
  const text = decoder.decode(input);
  let pos = 0;

  /** Returns the next non-empty, non-comment line split into tokens. */
  const nextTokens = (): string[] | null => {
    while (pos < text.length) {
      let end = text.indexOf("\n", pos);
      if (end === -1) end = text.length;
      let line = text.slice(pos, end);
      pos = end + 1;
      const hash = line.indexOf("#");
      if (hash !== -1) line = line.slice(0, hash);
      line = line.trim();
      if (line) return line.split(/\s+/);
    }
    return null;
  };

  let tokens = nextTokens();
  if (!tokens || !/^C?N?OFF$/i.test(tokens[0])) throw new Error("Not an OFF file");
  tokens = tokens.length > 1 ? tokens.slice(1) : nextTokens();
  if (!tokens || tokens.length < 2) throw new Error("OFF header missing counts");
  const nv = parseInt(tokens[0], 10);
  const nf = parseInt(tokens[1], 10);

  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const t = nextTokens();
    if (!t || t.length < 3) throw new Error(`OFF vertex ${i} malformed`);
    positions[i * 3] = +t[0];
    positions[i * 3 + 1] = +t[1];
    positions[i * 3 + 2] = +t[2];
  }

  const indices: number[] = [];
  const colors: number[] = [];
  let anyColor = false;
  for (let f = 0; f < nf; f++) {
    const t = nextTokens();
    if (!t) throw new Error(`OFF face ${f} missing`);
    const n = parseInt(t[0], 10);
    const rest = t.slice(1 + n);
    let rgba: [number, number, number, number] = [0, 0, 0, 0];
    if (rest.length >= 3) {
      anyColor = true;
      const isFloat = rest.some((s) => s.includes("."));
      const conv = (s: string | undefined, dflt: number) =>
        s === undefined ? dflt : isFloat ? Math.round(Math.min(1, Math.max(0, +s)) * 255) : Math.min(255, Math.max(0, parseInt(s, 10)));
      rgba = [conv(rest[0], 0), conv(rest[1], 0), conv(rest[2], 0), conv(rest[3], 255)];
    }
    // Fan-triangulate polygons (Manifold output is already triangles).
    const v0 = +t[1];
    for (let k = 2; k < n; k++) {
      indices.push(v0, +t[k], +t[k + 1]);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }

  return {
    positions,
    indices: Uint32Array.from(indices),
    colors: anyColor ? Uint8Array.from(colors) : undefined,
  };
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

export function isBinaryStl(input: Uint8Array): boolean {
  if (input.length < 84) return false;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 === input.length) return true;
  // Some writers pad or truncate; fall back to the "solid" heuristic.
  const head = decoder.decode(input.subarray(0, Math.min(256, input.length))).trimStart();
  return !(head.startsWith("solid") && head.includes("facet"));
}

export function parseStl(input: Uint8Array): Mesh {
  return isBinaryStl(input) ? parseBinaryStl(input) : parseAsciiStl(input);
}

function parseBinaryStl(input: Uint8Array): Mesh {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const declared = view.getUint32(80, true);
  const count = Math.min(declared, Math.floor((input.length - 84) / 50));
  const positions = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const off = 84 + i * 50 + 12; // skip normal
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = view.getFloat32(off + k * 4, true);
  }
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

function parseAsciiStl(input: Uint8Array): Mesh {
  const text = decoder.decode(input);
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const coords: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) coords.push(+m[1], +m[2], +m[3]);
  const usable = coords.length - (coords.length % 9);
  const positions = Float32Array.from(coords.slice(0, usable));
  const indices = new Uint32Array(usable / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}
