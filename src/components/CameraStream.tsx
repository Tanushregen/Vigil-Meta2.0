import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CameraFeed } from '../types';
import type { CameraPipeline } from '../utils/cameraPipeline';
import type { PersonRegistry } from '../utils/personRegistry';
import { SKELETON_PAIRS } from '../utils/yoloPose';

export interface CameraSource {
  deviceId?: string;
  fileUrl?: string;
  fileName?: string;
  /** The file as chosen (kept so it can be converted if the browser cannot play it) */
  file?: File;
  /** fileUrl already points at a converted MP4 */
  converted?: boolean;
}

interface CameraStreamProps {
  cam: CameraFeed;
  source: CameraSource;
  pipeline: CameraPipeline;
  registry: PersonRegistry;
  /** Camera is monitoring (Start/Pause button) */
  active: boolean;
  /** The browser could not play the chosen video file: the parent can convert it and swap the source */
  onUnplayable?: () => void;
}

/**
 * One real camera tile: plays a webcam / screen / video file, feeds the frames to the camera's pipeline, and draws the
 * tracked people on top, each labelled with their room-wide ID (P1, P2, ...) and coloured the same on every camera.
 */
export const CameraStream: React.FC<CameraStreamProps> = ({ cam, source, pipeline, registry, active, onUnplayable }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start / stop the media source and the pipeline
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    const begin = async () => {
      setError(null);
      if (!active) return;
      try {
        if (cam.sourceType === 'webcam') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true,
            audio: false,
          });
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          v.srcObject = stream;
        } else if (cam.sourceType === 'screen') {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          v.srcObject = stream;
        } else if (cam.sourceType === 'video_file') {
          if (!source.fileUrl) {
            setError('Choose a video file for this camera');
            return;
          }
          v.srcObject = null;
          v.src = source.fileUrl;
          v.loop = true;
        } else {
          return;
        }
        v.muted = true;
        await v.play();
        if (cancelled) return;
        pipeline.setVideo(v);
        pipeline.start();
      } catch (err: any) {
        if (cancelled) return;
        const msg = String(err?.message || '');
        if (cam.sourceType === 'video_file' && /no supported source|not supported|decode/i.test(msg) && !source.converted && source.file && onUnplayable) {
          setError('This video format is not supported by the browser. Converting it to MP4…');
          onUnplayable();
        } else {
          setError(msg || 'Could not open this source');
        }
      }
    };
    void begin();

    return () => {
      cancelled = true;
      pipeline.stop();
      stream?.getTracks().forEach((t) => t.stop());
      v.pause();
      v.srcObject = null;
      v.removeAttribute('src');
    };
  }, [cam.sourceType, source.deviceId, source.fileUrl, active, pipeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overlay: tracked people with room-wide IDs
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const v = videoRef.current;
      if (!canvas || !v) return;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, cw, ch);
      if (!v.videoWidth || !v.videoHeight) return;

      // Until the detector finishes its first pass (models are loading) say so instead of looking like "no one found"
      if (!pipeline.ready && active) {
        const msg = pipeline.error ? `Detector error: ${pipeline.error.slice(0, 60)}` : 'Loading detector…';
        ctx.font = 'bold 11px monospace';
        const w = ctx.measureText(msg).width + 12;
        ctx.fillStyle = pipeline.error ? 'rgba(190,18,60,0.9)' : 'rgba(15,23,42,0.85)';
        ctx.fillRect(8, ch - 26, w, 18);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(msg, 14, ch - 13);
      }

      // object-contain mapping of normalized 0-1000 coordinates
      const vr = v.videoWidth / v.videoHeight;
      const cr = cw / ch;
      const rw = vr > cr ? cw : ch * vr;
      const rh = vr > cr ? cw / vr : ch;
      const ox = (cw - rw) / 2;
      const oy = (ch - rh) / 2;
      const px = (x: number) => ox + (x / 1000) * rw;
      const py = (y: number) => oy + (y / 1000) * rh;

      const now = Date.now();
      for (const t of pipeline.getTracks()) {
        const person = t.gid !== undefined ? registry.getPerson(t.gid) : undefined;
        const violations = person ? [...person.violations.values()].filter((x) => x.active && x.camId === cam.id) : [];
        const color = violations.length ? '#f43f5e' : t.color;
        const x1 = px(t.box.xmin);
        const y1 = py(t.box.ymin);
        const w = px(t.box.xmax) - x1;
        const h = py(t.box.ymax) - y1;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = violations.length ? 3 : 2;
        ctx.strokeRect(x1, y1, w, h);

        if (t.pose) {
          const kp = new Map(t.pose.keypoints.map((k) => [k.id, k]));
          ctx.lineWidth = 2;
          ctx.strokeStyle = t.color;
          for (const link of SKELETON_PAIRS) {
            const a = kp.get(link.from);
            const b = kp.get(link.to);
            if (a && b && a.score >= 0.4 && b.score >= 0.4) {
              ctx.beginPath();
              ctx.moveTo(px(a.x), py(a.y));
              ctx.lineTo(px(b.x), py(b.y));
              ctx.stroke();
            }
          }
        }

        const others = person ? [...person.sightings.values()].filter((s) => s.camId !== cam.id && now - s.ts < 8000).length : 0;
        const tag = `${t.label}${t.pose ? ' · ' + t.pose.posture : ''}${others ? ` · +${others} cam` : ''}`;
        ctx.font = 'bold 11px monospace';
        const tw = ctx.measureText(tag).width + 10;
        ctx.fillStyle = color;
        ctx.fillRect(x1, Math.max(0, y1 - 17), tw, 17);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(tag, x1 + 5, Math.max(12, y1 - 5));

        if (violations.length) {
          const text = violations.map((x) => x.ruleName).join(', ');
          ctx.font = 'bold 10px sans-serif';
          const vw = ctx.measureText(text).width + 10;
          ctx.fillStyle = '#be123c';
          ctx.fillRect(x1, y1 + h + 2, vw, 15);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, x1 + 5, y1 + h + 13);
        }
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pipeline, registry, cam.id, active]);

  return (
    <div className="relative w-full h-full bg-black">
      <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center bg-slate-950/90 text-rose-300 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-500" />
          <span>{error}</span>
        </div>
      )}
      {!active && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-400 text-xs">Paused</div>
      )}
    </div>
  );
};
