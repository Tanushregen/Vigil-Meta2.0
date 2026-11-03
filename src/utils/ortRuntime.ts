/**
 * Shared ONNX Runtime Web setup for the in-browser vision models (YOLO detector, SAM segmenter).
 * Picks WebGPU when the browser exposes an adapter, otherwise CPU/WASM running in a worker
 * so heavy inference never freezes the UI.
 */

type OrtModule = typeof import('onnxruntime-web');

export interface OrtRuntime {
  ort: OrtModule;
  backend: 'webgpu' | 'wasm';
}

// The default bundle embeds the WebGPU (JSEP) glue, which must be paired with the JSEP binary. That binary also runs the CPU EP.
const WASM_BINARY = '/ort/ort-wasm-simd-threaded.jsep.wasm';

let runtimePromise: Promise<OrtRuntime> | null = null;

export function getOrt(): Promise<OrtRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const ort = await import('onnxruntime-web');

      let hasGpu = false;
      try {
        hasGpu = !!(navigator as any).gpu && !!(await (navigator as any).gpu.requestAdapter());
      } catch {
        hasGpu = false;
      }

      // The bundled runtime embeds its JS glue; only the .wasm binary is fetched (same-origin, from public/ort).
      ort.env.wasm.wasmPaths = { wasm: WASM_BINARY } as any;
      // Multi-threaded wasm needs cross-origin isolation; fall back to a single thread otherwise.
      ort.env.wasm.numThreads =
        typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
          ? Math.min(4, navigator.hardwareConcurrency || 2)
          : 1;
      // CPU fallback runs in a worker so SAM's multi-second encoder pass can't block rendering.
      if (!hasGpu) ort.env.wasm.proxy = true;

      return { ort, backend: hasGpu ? 'webgpu' : 'wasm' } as OrtRuntime;
    })();
    runtimePromise.catch(() => {
      runtimePromise = null;
    });
  }
  return runtimePromise;
}

// ONNX Runtime Web runs one inference at a time per wasm instance; overlapping run() calls from
// different sessions (YOLO + SAM) fail with "Session already started". Serialize them here.
let runChain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = runChain.then(fn, fn) as Promise<T>;
  runChain = next.catch(() => undefined);
  return next;
}
