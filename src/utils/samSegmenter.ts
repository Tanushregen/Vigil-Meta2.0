/**
 * Box-prompted segmentation with SAM 3 (tracker, int8 ONNX).
 * YOLO supplies the boxes; SAM turns each box into a pixel mask. The mask is used to
 *   - refine the box,
 *   - draw a silhouette overlay,
 *   - cut a background-free crop that is sent to the reasoning model together with the rules.
 *
 * SAM runs on the CPU inside a dedicated Web Worker (its own ONNX Runtime instance), while the YOLO
 * detector keeps the GPU on the main thread, so the two never wait on each other.
 *
 * SAM 3.1 is gated and ships only as a PyTorch checkpoint, so this uses the SAM 3 tracker ONNX export. The module
 * is written against the generic "image encoder + box-prompt mask decoder" shape; model files can be swapped later.
 */

import type { BoundingBox } from '../types';
import { SAM_INPUT_SIZE, SAM_MASK_SIZE } from './samCore';
import type { SamPrompt, SegmentedTarget } from './samCore';
import type { SamBackend, SamWorkerRequest, SamWorkerResponse } from '../workers/samWorker';

export { SAM_MASK_SIZE };
export type { SamPrompt, SegmentedTarget };
export { buildPosePoints } from './samCore';

let worker: Worker | null = null;
let readyPromise: Promise<{ provider: string }> | null = null;
let nextId = 1;
// SAM 3's encoder is far too heavy for a CPU to be the first choice: use the GPU when the browser has one
let backend: SamBackend = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'cpu';
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let scratch: HTMLCanvasElement | null = null;

// -----------------------------------------------------------------------------
// Model lifecycle: lets the UI show "loading model" separately from "segmenting"
// -----------------------------------------------------------------------------
export type SamModelState = 'idle' | 'loading' | 'ready' | 'error';
let modelState: SamModelState = 'idle';
let modelProvider = '';
let preloadPromise: Promise<void> | null = null;
const modelListeners = new Set<() => void>();

function setModelState(next: SamModelState): void {
  if (modelState === next) return;
  modelState = next;
  modelListeners.forEach((l) => l());
}

export function getSamModelState(): SamModelState {
  return modelState;
}

export function getSamProvider(): string {
  return modelProvider;
}

export function subscribeSamModel(listener: () => void): () => void {
  modelListeners.add(listener);
  return () => {
    modelListeners.delete(listener);
  };
}

function resetModel(): void {
  readyPromise = null;
  preloadPromise = null;
  setModelState('idle');
}

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
      resetModel();
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

/** Stops SAM immediately: kills the worker (and any pass running in it). It reloads on the next preload or call. */
export function cancelSam(): void {
  const err = new Error('SAM cancelled');
  pending.forEach((p) => p.reject(err));
  pending.clear();
  worker?.terminate();
  worker = null;
  resetModel();
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
  resetModel();
}

/**
 * Spins up the worker and loads the SAM 3 encoder + decoder. Starts on WebGPU when available; if the GPU build cannot
 * load (no WebGPU adapter, no fp16 shader support) it falls back to the int8 build on the CPU.
 */
export function loadSam(): Promise<{ provider: string }> {
  if (!readyPromise) {
    const attempt = () => call<Extract<SamWorkerResponse, { type: 'ready' }>>({ type: 'init', id: nextId++, backend });
    readyPromise = attempt()
      .catch((err) => {
        if (backend !== 'webgpu') throw err;
        console.warn('[SAM] WebGPU build failed to load, falling back to CPU:', err?.message || err);
        backend = 'cpu';
        worker?.terminate();
        worker = null;
        return attempt();
      })
      .then((r) => {
        modelProvider = r.provider;
        return { provider: r.provider };
      });
    readyPromise.catch(() => {
      readyPromise = null;
    });
  }
  return readyPromise;
}

/**
 * Loads SAM ahead of the first scan: starts the worker, downloads and creates the encoder + decoder, then (on the GPU)
 * runs one throw-away pass so WebGPU shader compilation and buffer allocation are already done when real frames arrive.
 * Safe to call repeatedly; it returns the same promise until the model is cancelled or fails.
 */
export function preloadSam(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  setModelState('loading');
  const t0 = performance.now();
  const run = (async () => {
    const { provider } = await loadSam();
    const tLoaded = performance.now();
    modelProvider = provider;
    if (backend === 'webgpu') {
      // A neutral gray frame with a centered box is enough to exercise the encoder and the decoder once
      const frame = new Uint8ClampedArray(SAM_INPUT_SIZE * SAM_INPUT_SIZE * 4).fill(128).buffer as ArrayBuffer;
      await call<Extract<SamWorkerResponse, { type: 'result' }>>(
        { type: 'segment', id: nextId++, pixels: frame, prompts: [{ box: { xmin: 300, ymin: 200, xmax: 700, ymax: 900 } }] },
        [frame]
      );
    }
    setModelState('ready');
    console.info(`[SAM] preloaded on ${provider}: model ${Math.round(tLoaded - t0)}ms, warm-up ${Math.round(performance.now() - tLoaded)}ms`);
  })().catch((err) => {
    if (/cancelled|backend switched/.test(String(err?.message))) return; // reset already put the state back to idle
    console.warn('[SAM] preload failed:', err?.message || err);
    preloadPromise = null;
    setModelState('error');
  });
  preloadPromise = run;
  return run;
}

/**
 * Encodes the frame once, then decodes one mask per prompt (box + optional click points) in the worker.
 * `source` is whatever canvas / video the frame was captured from. The result is index-aligned with `prompts`.
 */
export async function segmentBoxes(
  source: CanvasImageSource,
  prompts: SamPrompt[]
): Promise<(SegmentedTarget | null)[]> {
  if (prompts.length === 0) return [];
  await loadSam();

  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = SAM_INPUT_SIZE;
    scratch.height = SAM_INPUT_SIZE;
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return prompts.map(() => null);
  ctx.drawImage(source, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  const pixels = ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE).data;
  const buffer = pixels.buffer.slice(0) as ArrayBuffer; // detach-safe copy to transfer

  const res = await call<Extract<SamWorkerResponse, { type: 'result' }>>(
    { type: 'segment', id: nextId++, pixels: buffer, prompts },
    [buffer]
  );
  return res.targets;
}

/**
 * Cuts the masked object out of `frame` (background painted neutral gray) and returns a JPEG data URL.
 * `box` is the region to crop (normalized 0-1000), `mask` the full-frame 288x288 mask.
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

let segmentBusy = false;

/**
 * Segments only if SAM is loaded and not already working, and never waits longer than `budgetMs`.
 * Returns null when SAM could not take the job right now (callers fall back to plain box crops). This is the shared
 * entry point for several cameras: one SAM pass at a time, the others simply skip masks for that scan.
 */
export async function segmentIfReady(
  source: CanvasImageSource,
  prompts: SamPrompt[],
  budgetMs: number = 8000
): Promise<(SegmentedTarget | null)[] | null> {
  if (modelState !== 'ready' || segmentBusy || prompts.length === 0) return null;
  segmentBusy = true;
  const work = segmentBoxes(source, prompts).finally(() => {
    segmentBusy = false;
  });
  const safe = work.catch(() => null);
  return Promise.race([safe, new Promise<null>((r) => setTimeout(() => r(null), budgetMs))]);
}
