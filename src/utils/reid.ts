/**
 * Person re-identification with OSNet x0.25 (MSMT17), run in the browser with ONNX Runtime Web.
 * Turns a person crop into a 512-d appearance fingerprint; two crops of the same person (even from different cameras)
 * land close together (cosine similarity), different people land far apart. The shared identity registry uses this
 * to give one person the same global ID on every camera.
 *
 * The exported model has a fixed batch of 16, so inputs are padded to 16 and only the real rows are returned.
 */

import type { BoundingBox } from '../types';
import { getOrt, runExclusive } from './ortRuntime';

export const REID_MODEL_URL = '/models/osnet_x0_25_msmt17.onnx';
export const REID_W = 128;
export const REID_H = 256;
export const REID_BATCH = 16;
export const REID_DIM = 512;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** RGBA pixels of one REID_W x REID_H crop -> planar normalized RGB written into `out` at `slot` (0..15). */
export function writeReidInput(rgba: Uint8ClampedArray | Uint8Array, out: Float32Array, slot: number): void {
  const plane = REID_W * REID_H;
  const base = slot * 3 * plane;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[base + i] = (rgba[p] / 255 - MEAN[0]) / STD[0];
    out[base + plane + i] = (rgba[p + 1] / 255 - MEAN[1]) / STD[1];
    out[base + 2 * plane + i] = (rgba[p + 2] / 255 - MEAN[2]) / STD[2];
  }
}

export function l2Normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine similarity of two L2-normalized vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/** Splits the model's [16, 512] output into L2-normalized per-person embeddings (first `count` rows). */
export function splitEmbeddings(data: Float32Array, count: number): Float32Array[] {
  const rows: Float32Array[] = [];
  for (let r = 0; r < count; r++) rows.push(l2Normalize(data.slice(r * REID_DIM, (r + 1) * REID_DIM)));
  return rows;
}

// -----------------------------------------------------------------------------
// Browser runtime
// -----------------------------------------------------------------------------

let sessionPromise: Promise<{ ort: any; session: any }> | null = null;
let cropCanvas: HTMLCanvasElement | null = null;

export function loadReid(): Promise<{ ort: any; session: any }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { ort, backend } = await getOrt();
      const session = await runExclusive<any>(() =>
        ort.InferenceSession.create(REID_MODEL_URL, { executionProviders: [backend], graphOptimizationLevel: 'all' })
      );
      return { ort, session };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/**
 * Embeds up to 16 people in one pass. `source` is the current frame (video or canvas); each box is normalized 0-1000
 * in that frame. Returns one embedding per box, index-aligned.
 */
export async function embedPeople(source: CanvasImageSource & { videoWidth?: number; width?: number }, boxes: BoundingBox[]): Promise<Float32Array[]> {
  const batch = boxes.slice(0, REID_BATCH);
  if (batch.length === 0) return [];
  const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLCanvasElement).width;
  const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLCanvasElement).height;
  if (!sw || !sh) return [];

  const { ort, session } = await loadReid();
  if (!cropCanvas) {
    cropCanvas = document.createElement('canvas');
    cropCanvas.width = REID_W;
    cropCanvas.height = REID_H;
  }
  const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const input = new Float32Array(REID_BATCH * 3 * REID_W * REID_H); // unused slots stay zero
  batch.forEach((b, slot) => {
    const x = Math.max(0, (b.xmin / 1000) * sw);
    const y = Math.max(0, (b.ymin / 1000) * sh);
    const w = Math.max(8, ((b.xmax - b.xmin) / 1000) * sw);
    const h = Math.max(16, ((b.ymax - b.ymin) / 1000) * sh);
    ctx.drawImage(source, x, y, Math.min(w, sw - x), Math.min(h, sh - y), 0, 0, REID_W, REID_H);
    writeReidInput(ctx.getImageData(0, 0, REID_W, REID_H).data, input, slot);
  });

  const tensor = new ort.Tensor('float32', input, [REID_BATCH, 3, REID_H, REID_W]);
  const out = await runExclusive<any>(() => session.run({ [session.inputNames[0]]: tensor }));
  return splitEmbeddings(out[session.outputNames[0]].data as Float32Array, batch.length);
}
