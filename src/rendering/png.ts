/**
 * PNG / APNG encoder and a small PNG decoder, using Node's native zlib.
 */

import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function ihdr(width: number, height: number): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = 8; // bit depth
  d[9] = 2; // colour type: RGB (previews are opaque)
  return chunk("IHDR", d);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filters RGBA → RGB scanlines, picking the filter with the smallest residual per row. */
function filterRows(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  const out = Buffer.alloc((stride + 1) * height);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const types = [0, 1, 2, 4];
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : undefined;
    let best = 0;
    let bestSum = Infinity;
    for (let t = 0; t < 4; t++) {
      const buf = cand[t];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 3 ? prev[x - 3] : 0;
        let v: number;
        switch (types[t]) {
          case 0: v = row[x]; break;
          case 1: v = row[x] - a; break;
          case 2: v = row[x] - b; break;
          default: v = row[x] - paeth(a, b, c); break;
        }
        v &= 0xff;
        buf[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = t;
      }
    }
    out[y * (stride + 1)] = types[best];
    out.set(cand[best], y * (stride + 1) + 1);
  }
  return out;
}

function compress(rgba: Uint8Array, width: number, height: number): Buffer {
  return deflateSync(filterRows(rgba, width, height), { level: 6 });
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return new Uint8Array(
    Buffer.concat([SIGNATURE, ihdr(width, height), chunk("IDAT", compress(rgba, width, height)), chunk("IEND", new Uint8Array(0))]),
  );
}

const IEND_BYTES = 12;

/**
 * Builds an animated PNG one frame at a time: each RGBA frame is compressed as
 * it is added, so the caller never holds every frame's pixels at once.
 */
export class ApngWriter {
  private readonly parts: Buffer[];
  private bytes = 0;
  private seq = 0;
  private added = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly frameCount: number,
    private readonly delayMs: number,
  ) {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(frameCount, 0);
    actl.writeUInt32BE(0, 4); // loop forever
    this.parts = [];
    this.push(Buffer.from(SIGNATURE), ihdr(width, height), chunk("acTL", actl));
  }

  /** Frames added so far. */
  get frames(): number {
    return this.added;
  }

  /** Size the file would have if it ended after the frames added so far. */
  get size(): number {
    return this.bytes + IEND_BYTES;
  }

  addFrame(rgba: Uint8Array): void {
    if (this.added === this.frameCount) throw new Error(`The animation already has its ${this.frameCount} frames.`);
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(this.seq++, 0);
    fctl.writeUInt32BE(this.width, 4);
    fctl.writeUInt32BE(this.height, 8);
    fctl.writeUInt32BE(0, 12);
    fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(Math.max(1, Math.round(this.delayMs)), 20);
    fctl.writeUInt16BE(1000, 22);
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    const data = compress(rgba, this.width, this.height);
    if (this.added === 0) {
      this.push(chunk("fcTL", fctl), chunk("IDAT", data));
    } else {
      const fdat = Buffer.alloc(4 + data.length);
      fdat.writeUInt32BE(this.seq++, 0);
      data.copy(fdat, 4);
      this.push(chunk("fcTL", fctl), chunk("fdAT", fdat));
    }
    this.added++;
  }

  finish(): Uint8Array {
    if (this.added !== this.frameCount) throw new Error(`The animation has ${this.added} of its ${this.frameCount} frames.`);
    return new Uint8Array(Buffer.concat([...this.parts, chunk("IEND", new Uint8Array(0))]));
  }

  private push(...buffers: Buffer[]): void {
    for (const b of buffers) {
      this.parts.push(b);
      this.bytes += b.length;
    }
  }
}

/** Animated PNG; frames are RGBA buffers of identical size. */
export function encodeApng(frames: Uint8Array[], width: number, height: number, delayMs: number): Uint8Array {
  const writer = new ApngWriter(width, height, frames.length, delayMs);
  for (const frame of frames) writer.addFrame(frame);
  return writer.finish();
}

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Decodes 8-bit, non-interlaced PNGs (grey, grey+alpha, RGB, RGBA, palette). */
export function decodePng(bytes: Uint8Array): DecodedImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG");
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`Unsupported PNG (bit depth ${bitDepth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const dst = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? dst[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      dst[x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    switch (colorType) {
      case 0: rgba[d] = rgba[d + 1] = rgba[d + 2] = pixels[s]; rgba[d + 3] = 255; break;
      case 4: rgba[d] = rgba[d + 1] = rgba[d + 2] = pixels[s]; rgba[d + 3] = pixels[s + 1]; break;
      case 2: rgba[d] = pixels[s]; rgba[d + 1] = pixels[s + 1]; rgba[d + 2] = pixels[s + 2]; rgba[d + 3] = 255; break;
      case 6: rgba.set(pixels.subarray(s, s + 4), d); break;
      case 3: {
        const p = pixels[s];
        rgba[d] = palette?.[p * 3] ?? 0;
        rgba[d + 1] = palette?.[p * 3 + 1] ?? 0;
        rgba[d + 2] = palette?.[p * 3 + 2] ?? 0;
        rgba[d + 3] = trns && p < trns.length ? trns[p] : 255;
        break;
      }
    }
  }
  return { width, height, rgba };
}
