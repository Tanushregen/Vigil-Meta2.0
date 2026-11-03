/**
 * One perception pipeline per camera: pose detection -> ByteTrack (local track IDs) -> appearance fingerprints ->
 * the shared room registry (global person IDs). It also builds the per-person payload (crop, SAM mask, shared context)
 * that goes to Muse Spark when the camera is scanned.
 */

import type { BoundingBox, PoseSkeleton, PromptRule } from '../types';
import { ByteTracker } from './byteTrack';
import { detectPoses } from './poseDetector';
import { embedPeople, REID_BATCH } from './reid';
import { PersonRegistry, PERSON_COLORS } from './personRegistry';
import type { TrackObservation } from './personRegistry';
import { buildPosePoints, maskedCropDataUrl, segmentIfReady } from './samSegmenter';

/** A person needs this many matched frames and this much height before their fingerprint is trusted. */
const MIN_HITS_FOR_ID = 3;
/** ...but a track must persist this many frames before it may create a brand-new person */
const MIN_HITS_TO_CREATE = 10;
const MIN_HEIGHT_FOR_ID = 120; // of 1000
/** Re-fingerprint an identified person this often so the registry sees new viewpoints / lighting. */
const REFRESH_EMBEDDING_MS = 5000;
const MAX_TARGETS = 6;
/** Weak pose detections are usually duplicates or background clutter and would spawn ghost people */
const MIN_POSE_SCORE = 0.45;

export interface PipelineTrack {
  trackId: number;
  gid?: number;
  label: string;
  color: string;
  box: BoundingBox;
  pose?: PoseSkeleton;
  score: number;
}

export interface TargetPayload {
  id: number;
  globalId?: number;
  label: string;
  box: BoundingBox;
  masked: boolean;
  crop: string;
  /** What the room already knows about this person (other cameras, active violations) */
  context: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CameraPipeline {
  readonly camId: string;
  private registry: PersonRegistry;
  private tracker = new ByteTracker(0.4, 0.25, 30);
  private video: HTMLVideoElement | null = null;
  private running = false;
  private tracks: PipelineTrack[] = [];
  private gidByTrack = new Map<number, number>();
  private lastEmbedAt = new Map<number, number>();
  private frameCanvas: HTMLCanvasElement | null = null;
  /** Latest pose/detection pass duration, for the camera badge */
  lastPassMs = 0;
  /** True once the detector has completed at least one pass (models loaded) */
  ready = false;
  error: string | null = null;

  constructor(camId: string, registry: PersonRegistry) {
    this.camId = camId;
    this.registry = registry;
  }

  setVideo(video: HTMLVideoElement | null): void {
    this.video = video;
  }

  getTracks(): PipelineTrack[] {
    return this.tracks;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.ready = false;
    this.tracks = [];
    this.gidByTrack.clear();
    this.lastEmbedAt.clear();
    this.tracker.reset();
    this.registry.clearCamera(this.camId);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const v = this.video;
      if (!v || v.readyState < 2 || v.paused || v.ended || !v.videoWidth) {
        await sleep(150);
        continue;
      }
      const t0 = performance.now();
      try {
        const poses = (await detectPoses(v, MIN_POSE_SCORE));
        if (!this.running) return;

        const tracked = this.tracker.update(
          poses.map((p) => ({ box: p.box, score: p.score, label: 'person', pose: p.pose }))
        );
        const live = tracked.filter((t) => t.state === 'Tracked' && t.timeSinceUpdate === 0);
        const now = Date.now();

        // Which live tracks need a fresh fingerprint: unidentified ones, and identified ones that are due a refresh
        const needEmbed = live.filter((t) => {
          if (t.hits < MIN_HITS_FOR_ID) return false;
          if (t.box.ymax - t.box.ymin < MIN_HEIGHT_FOR_ID) return false;
          const last = this.lastEmbedAt.get(t.trackId);
          return !this.gidByTrack.has(t.trackId) ? last === undefined || now - last > 1000 : last === undefined || now - last > REFRESH_EMBEDDING_MS;
        });

        const embeddings = new Map<number, Float32Array>();
        if (needEmbed.length) {
          const batch = needEmbed.slice(0, REID_BATCH);
          const result = await embedPeople(v, batch.map((t) => t.box));
          if (!this.running) return;
          batch.forEach((t, i) => {
            if (result[i]) {
              embeddings.set(t.trackId, result[i]);
              this.lastEmbedAt.set(t.trackId, now);
            }
          });
        }

        const observations: TrackObservation[] = live.map((t) => ({
          trackId: t.trackId,
          embedding: embeddings.get(t.trackId) ?? null,
          box: t.box,
          posture: t.pose?.posture,
          canCreate: t.hits >= MIN_HITS_TO_CREATE,
        }));
        const ids = this.registry.observe(this.camId, observations, now);
        this.gidByTrack = new Map(ids);

        this.tracks = tracked.map((t) => {
          const gid = ids.get(t.trackId);
          const person = gid !== undefined ? this.registry.getPerson(gid) : undefined;
          return {
            trackId: t.trackId,
            gid,
            label: person?.label ?? '?',
            color: person?.color ?? PERSON_COLORS[t.trackId % PERSON_COLORS.length],
            box: t.box,
            pose: t.pose,
            score: t.score,
          };
        });
        this.error = null;
        this.ready = true;
      } catch (err: any) {
        this.error = String(err?.message || err);
        await sleep(500);
      }
      this.lastPassMs = Math.round(performance.now() - t0);
      await sleep(30);
    }
  }

  /** Current frame as a JPEG data URL (640 wide), or null if the video is not ready. */
  captureFrame(): string | null {
    const c = this.snapshotCanvas();
    if (!c) return null;
    try {
      return c.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  }

  private snapshotCanvas(): HTMLCanvasElement | null {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
    if (!this.frameCanvas) this.frameCanvas = document.createElement('canvas');
    const c = this.frameCanvas;
    c.width = 640;
    c.height = Math.round((v.videoHeight / v.videoWidth) * 640) || 360;
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    return c;
  }

  /**
   * The per-person payload for a scan: for each identified person on this camera, a (SAM-masked when possible) crop,
   * their box, and everything the room knows about them. SAM is optional and never blocks the scan.
   */
  async buildTargets(camNames: Record<string, string>): Promise<TargetPayload[]> {
    const snap = this.snapshotCanvas();
    if (!snap) return [];
    const area = (b: BoundingBox) => (b.xmax - b.xmin) * (b.ymax - b.ymin);
    const people = this.tracks
      .filter((t) => t.gid !== undefined && t.pose)
      .sort((a, b) => area(b.box) - area(a.box))
      .slice(0, MAX_TARGETS);
    if (people.length === 0) return [];

    // Freeze this frame: the shared canvas is overwritten by the next capture
    const frozen = document.createElement('canvas');
    frozen.width = snap.width;
    frozen.height = snap.height;
    frozen.getContext('2d')?.drawImage(snap, 0, 0);

    const segs = await segmentIfReady(
      frozen,
      people.map((t) => ({
        box: t.box,
        points: buildPosePoints(
          t.pose!.keypoints,
          t.box,
          people.filter((o) => o.trackId !== t.trackId).map((o) => o.pose!.keypoints)
        ),
      }))
    );

    const now = Date.now();
    return people.map((t, i) => {
      const seg = segs?.[i] ?? null;
      const box = seg ? seg.box : t.box;
      return {
        id: t.trackId,
        globalId: t.gid,
        label: t.label,
        box,
        masked: !!seg,
        crop: maskedCropDataUrl(frozen, seg ? seg.mask : null, box),
        context: this.registry.describe(t.gid!, this.camId, camNames, now),
      };
    });
  }

  /**
   * Record Muse Spark's verdict in the registry: each person scanned on this camera gets exactly the violations that
   * were reported for them (and any earlier ones no longer reported are marked resolved).
   */
  applyVerdict(
    scanned: TargetPayload[],
    violations: Array<{ targetId?: number; ruleId: string; explanation?: string }>,
    rules: PromptRule[]
  ): void {
    const now = Date.now();
    for (const t of scanned) {
      if (t.globalId === undefined) continue;
      const mine = violations
        .filter((v) => v.targetId === t.id)
        .map((v) => {
          const rule = rules.find((r) => r.id === v.ruleId);
          return {
            ruleId: v.ruleId,
            ruleName: rule?.name || v.ruleId,
            severity: rule?.severity || 'high',
            explanation: v.explanation || '',
          };
        });
      this.registry.setViolations(t.globalId, this.camId, mine, now);
    }
  }
}
