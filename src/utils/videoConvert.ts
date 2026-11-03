/**
 * Plays formats browsers cannot (AVI, MKV, WMV, FLV, MPEG, ...) by converting them to H.264 MP4 right in the browser
 * with ffmpeg.wasm. The converter (~32 MB) is only downloaded the first time a file needs it.
 *
 * The output is downscaled to 640 px wide at 15 fps with no audio: that is plenty for detection and keeps the
 * conversion quick, even for long clips.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_URL = '/ffmpeg/ffmpeg-core.js';
const WASM_URL = '/ffmpeg/ffmpeg-core.wasm';

/** Containers browsers play natively (MP4/WebM/Ogg/MOV). Everything else gets converted. */
const NATIVE_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'ogg', 'mov']);

export function needsConversion(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (NATIVE_EXTENSIONS.has(ext)) return false;
  // Unknown extension: trust the browser if it claims it can play the MIME type
  if (file.type && document.createElement('video').canPlayType(file.type) !== '') return false;
  return true;
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

const LOAD_TIMEOUT_MS = 8000;
const LOAD_ATTEMPTS = 3;

/** One attempt: a fresh worker, abandoned if it does not report ready in time (a stuck worker never rejects by itself). */
async function createFfmpeg(): Promise<FFmpeg> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const ff = new FFmpeg();
  // Blob URLs keep the dev server from rewriting the core script (it would break the dynamic import)
  const coreURL = await toBlobURL(CORE_URL, 'text/javascript');
  const wasmURL = await toBlobURL(WASM_URL, 'application/wasm');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ff.load({ coreURL, wasmURL }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The video converter did not start in time')), LOAD_TIMEOUT_MS);
      }),
    ]);
    return ff;
  } catch (err) {
    ff.terminate();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
        try {
          return await createFfmpeg();
        } catch (err) {
          lastErr = err;
          console.warn(`[convert] converter start failed (attempt ${attempt}/${LOAD_ATTEMPTS}):`, err);
        }
      }
      throw lastErr;
    })();
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

// One conversion at a time: ffmpeg.wasm keeps a single virtual filesystem
let queue: Promise<unknown> = Promise.resolve();

/** Converts `file` to a playable MP4 and returns an object URL for it. `onProgress` receives 0-100. */
export function convertToMp4(file: File, onProgress?: (percent: number) => void): Promise<string> {
  const run = async (): Promise<string> => {
    console.info('[convert] loading ffmpeg core');
    const ff = await loadFfmpeg();
    console.info('[convert] ffmpeg ready, writing input');
    const ext = file.name.split('.').pop()?.toLowerCase() || 'avi';
    const input = `in.${ext}`;
    const output = 'out.mp4';

    const handler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
    };
    ff.on('progress', handler);
    try {
      await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      console.info('[convert] running ffmpeg');
      const code = await ff.exec([
        '-i', input,
        '-an',
        '-vf', 'scale=640:-2,fps=15',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        output,
      ]);
      if (code !== 0) throw new Error('This video could not be converted (unsupported or damaged file)');
      const data = (await ff.readFile(output)) as Uint8Array;
      onProgress?.(100);
      return URL.createObjectURL(new Blob([data as BlobPart], { type: 'video/mp4' }));
    } finally {
      ff.off('progress', handler);
      await ff.deleteFile(input).catch(() => {});
      await ff.deleteFile(output).catch(() => {});
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
