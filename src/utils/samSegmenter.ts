/**
 * Box-prompted segmentation with SAM 2.1 (tiny, int8).
 * YOLO supplies the boxes; SAM turns each box into a pixel mask. The mask is used to
 *   - refine the box,
 *   - draw a silhouette overlay,
 *   - cut a background-free crop that is sent to the reasoning model together with the rules.
 *
 * SAM runs on the CPU inside a dedicated Web Worker (its own ONNX Runtime instance), while the YOLO
 * detector keeps the GPU on the main thread, so the two never wait on each other.
 *
 * SAM 3.1 is gated and ships only as a PyTorch checkpoint, so this module is written against the
 * generic "image encoder + box-prompt mask decoder" shape and the model files can be swapped later.
 */

import type { BoundingBox } from '../types';
import { SAM_INPUT_SIZE, SAM_MASK_SIZE } from './samCore';
import type { SegmentedTarget } from './samCore';
import type { SamBackend, SamWorkerRequest, SamWorkerResponse } from '../workers/samWorker';

export { SAM_MASK_SIZE };
export type { SegmentedTarget };

let worker: Worker | null = null;
let readyPromise: Promise<{ provider: string }> | null = null;
let nextId = 1;
let backend: SamBackend = 'cpu';
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let scratch: HTMLCanvasElement | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/samWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SamWorkerResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'SAM worker crashed');
      pending.forEach((p) => p.reject(err));
      pending.clear();
      worker?.terminate();
      worker = null;
      readyPromise = null;
    };
  }
  return worker;
}

function call<T extends SamWorkerResponse>(req: SamWorkerRequest, transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    ensureWorker().postMessage(req, transfer);
  });
}

export function getSamBackend(): SamBackend {
  return backend;
}

/** Stops SAM immediately: kills the worker (and any pass running in it). It reloads lazily on the next call. */
export function cancelSam(): void {
  const err = new Error('SAM cancelled');
  pending.forEach((p) => p.reject(err));
  pending.clear();
  worker?.terminate();
  worker = null;
  readyPromise = null;
}

/** Restarts SAM in a fresh worker on another device (e.g. CPU -> GPU when the CPU pass is too slow). */
export function switchSamBackend(next: SamBackend): void {
  if (next === backend) return;
  backend = next;
  const err = new Error('SAM backend switched');
  pending.forEach((p) => p.reject(err));
  pending.clear();
  worker?.terminate();
  worker = null;
  readyPromise = null;
}

/** Spins up the worker and loads the SAM encoder + decoder (CPU by default, so the GPU stays free for YOLO). */
export function loadSam(): Promise<{ provider: string }> {
  if (!readyPromise) {
    readyPromise = call<Extract<SamWorkerResponse, { type: 'ready' }>>({ type: 'init', id: nextId++, backend })
      .then((r) => ({ provider: r.provider }));
    readyPromise.catch(() => {
      readyPromise = null;
    });
  }
  return readyPromise;
}

/**
 * Encodes the frame once, then decodes one mask per box prompt (in the worker).
 * `source` is whatever canvas / video the frame was captured from. The result is index-aligned with `boxes`.
 */
export async function segmentBoxes(
  source: CanvasImageSource,
  boxes: BoundingBox[]
): Promise<(SegmentedTarget | null)[]> {
  if (boxes.length === 0) return [];
  await loadSam();

  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = SAM_INPUT_SIZE;
    scratch.height = SAM_INPUT_SIZE;
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return boxes.map(() => null);
  ctx.drawImage(source, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  const pixels = ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE).data;
  const buffer = pixels.buffer.slice(0) as ArrayBuffer; // detach-safe copy to transfer

  const res = await call<Extract<SamWorkerResponse, { type: 'result' }>>(
    { type: 'segment', id: nextId++, pixels: buffer, boxes },
    [buffer]
  );
  return res.targets;
}

/**
 * Cuts the masked object out of `frame` (background painted neutral gray) and returns a JPEG data URL.
 * `box` is the region to crop (normalized 0-1000), `mask` the full-frame 256x256 mask.
 */
export function maskedCropDataUrl(
  frame: HTMLCanvasElement,
  mask: Uint8Array | null,
  box: BoundingBox,
  maxSide: number = 320
): string {
  const fw = frame.width;
  const fh = frame.height;
  const sx = Math.max(0, Math.floor((box.xmin / 1000) * fw));
  const sy = Math.max(0, Math.floor((box.ymin / 1000) * fh));
  const sw = Math.max(8, Math.min(fw - sx, Math.ceil(((box.xmax - box.xmin) / 1000) * fw)));
  const sh = Math.max(8, Math.min(fh - sy, Math.ceil(((box.ymax - box.ymin) / 1000) * fh)));

  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const out = document.createElement('canvas');
  out.width = Math.max(8, Math.round(sw * scale));
  out.height = Math.max(8, Math.round(sh * scale));
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) return '';
  octx.drawImage(frame, sx, sy, sw, sh, 0, 0, out.width, out.height);

  if (mask) {
    const img = octx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    for (let y = 0; y < out.height; y++) {
      const my = Math.min(SAM_MASK_SIZE - 1, Math.floor(((sy + (y / out.height) * sh) / fh) * SAM_MASK_SIZE));
      for (let x = 0; x < out.width; x++) {
        const mx = Math.min(SAM_MASK_SIZE - 1, Math.floor(((sx + (x / out.width) * sw) / fw) * SAM_MASK_SIZE));
        if (!mask[my * SAM_MASK_SIZE + mx]) {
          const p = (y * out.width + x) * 4;
          d[p] = 114;
          d[p + 1] = 114;
          d[p + 2] = 114;
        }
      }
    }
    octx.putImageData(img, 0, 0);
  }
  return out.toDataURL('image/jpeg', 0.85);
}
