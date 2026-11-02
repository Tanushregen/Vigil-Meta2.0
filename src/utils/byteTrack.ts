/**
 * ByteTrack: Multi-Object Tracking by Associating Every Detection Box
 * Implements high/low confidence 2-stage association, 2D Kalman motion filtering,
 * persistent Track IDs, and trajectory breadcrumb history.
 */

import { BoundingBox, TrackedPerson, TrackState, TrajectoryPoint, PoseSkeleton } from '../types';

// Deterministic high-contrast color palette for persistent track identification
export const TRACK_COLORS = [
  '#06b6d4', // cyan-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#3b82f6', // blue-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#a855f7', // purple-500
  '#6366f1', // indigo-500
];

export function getTrackColor(trackId: number): string {
  return TRACK_COLORS[Math.abs(trackId) % TRACK_COLORS.length];
}

/**
 * 2D Kalman Filter for Bounding Box Motion Prediction
 * State vector: [x, y, a, h, vx, vy, va, vh]
 * x, y: center of bounding box
 * a: aspect ratio (w / h)
 * h: height of bounding box
 * vx, vy, va, vh: corresponding velocities
 */
export class KalmanBoxTracker {
  // State: [x, y, a, h, vx, vy, va, vh]
  public mean: number[] = [0, 0, 1, 0, 0, 0, 0, 0];
  public covariance: number[][] = [];

  private static readonly STD_WEIGHT_POS = 1.0 / 20;
  private static readonly STD_WEIGHT_VEL = 1.0 / 160;

  constructor(box: BoundingBox) {
    const x = (box.xmin + box.xmax) / 2;
    const y = (box.ymin + box.ymax) / 2;
    const w = Math.max(1, box.xmax - box.xmin);
    const h = Math.max(1, box.ymax - box.ymin);
    const a = w / h;

    this.mean = [x, y, a, h, 0, 0, 0, 0];

    // Initialize diagonal covariance
    const std = [
      2 * KalmanBoxTracker.STD_WEIGHT_POS * h,
      2 * KalmanBoxTracker.STD_WEIGHT_POS * h,
      1e-2,
      2 * KalmanBoxTracker.STD_WEIGHT_POS * h,
      10 * KalmanBoxTracker.STD_WEIGHT_VEL * h,
      10 * KalmanBoxTracker.STD_WEIGHT_VEL * h,
      1e-5,
      10 * KalmanBoxTracker.STD_WEIGHT_VEL * h,
    ];

    this.covariance = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 8 }, (_, j) => (i === j ? std[i] * std[i] : 0))
    );
  }

  /**
   * Predict next bounding box state based on current velocity
   */
  public predict(): number[] {
    const h = this.mean[3];
    const stdPos = KalmanBoxTracker.STD_WEIGHT_POS * h;
    const stdVel = KalmanBoxTracker.STD_WEIGHT_VEL * h;

    // Motion model transition: pos += vel
    this.mean[0] += this.mean[4];
    this.mean[1] += this.mean[5];
    this.mean[2] += this.mean[6];
    this.mean[3] += this.mean[7];

    // Add process noise to covariance
    const q = [
      stdPos * stdPos,
      stdPos * stdPos,
      1e-4,
      stdPos * stdPos,
      stdVel * stdVel,
      stdVel * stdVel,
      1e-6,
      stdVel * stdVel,
    ];

    for (let i = 0; i < 8; i++) {
      this.covariance[i][i] += q[i];
    }

    return [...this.mean];
  }

  /**
   * Correct state with actual measurement from detection box
   */
  public update(box: BoundingBox): void {
    const measX = (box.xmin + box.xmax) / 2;
    const measY = (box.ymin + box.ymax) / 2;
    const measW = Math.max(1, box.xmax - box.xmin);
    const measH = Math.max(1, box.ymax - box.ymin);
    const measA = measW / measH;

    const measurement = [measX, measY, measA, measH];
    const h = measurement[3];
    const stdMeas = [
      KalmanBoxTracker.STD_WEIGHT_POS * h,
      KalmanBoxTracker.STD_WEIGHT_POS * h,
      1e-1,
      KalmanBoxTracker.STD_WEIGHT_POS * h,
    ];

    // Simple Kalman innovation update for [x, y, a, h]
    for (let i = 0; i < 4; i++) {
      const innovation = measurement[i] - this.mean[i];
      const measVariance = stdMeas[i] * stdMeas[i];
      const stateVariance = this.covariance[i][i];
      const kalmanGain = stateVariance / (stateVariance + measVariance + 1e-6);

      this.mean[i] += kalmanGain * innovation;
      this.covariance[i][i] *= 1 - kalmanGain;

      // Update corresponding velocity estimate
      const velIndex = i + 4;
      const velGain = (kalmanGain * 0.4);
      this.mean[velIndex] += velGain * (innovation);
    }
  }

  /**
   * Convert current mean state to BoundingBox [ymin, xmin, ymax, xmax]
   */
  public toBox(): BoundingBox {
    const x = this.mean[0];
    const y = this.mean[1];
    const a = Math.max(0.1, this.mean[2]);
    const h = Math.max(1, this.mean[3]);
    const w = a * h;

    return {
      xmin: Math.max(0, Math.min(1000, Math.round(x - w / 2))),
      ymin: Math.max(0, Math.min(1000, Math.round(y - h / 2))),
      xmax: Math.max(0, Math.min(1000, Math.round(x + w / 2))),
      ymax: Math.max(0, Math.min(1000, Math.round(y + h / 2))),
    };
  }
}

/**
 * Single Tracklet (STrack) representing a persistent detected person
 */
export class STrack {
  private static nextTrackId = 101;

  public trackId: number;
  public state: TrackState = 'New';
  public isActivated: boolean = false;
  public score: number;
  public box: BoundingBox;
  public kalman: KalmanBoxTracker;
  public hits: number = 1;
  public age: number = 1;
  public timeSinceUpdate: number = 0;
  public trajectory: TrajectoryPoint[] = [];
  public label: string;
  public color: string;
  public pose?: PoseSkeleton;
  public lastSeenTimestamp: number;

  constructor(box: BoundingBox, score: number, label: string = 'Person') {
    this.trackId = STrack.nextTrackId++;
    this.box = { ...box };
    this.score = score;
    this.label = label;
    this.color = getTrackColor(this.trackId);
    this.kalman = new KalmanBoxTracker(box);
    this.lastSeenTimestamp = Date.now();

    const cx = (box.xmin + box.xmax) / 2;
    const cy = (box.ymin + box.ymax) / 2;
    this.trajectory.push({ x: cx, y: cy, timestamp: this.lastSeenTimestamp });
  }

  public static resetIdCounter(startAt = 101): void {
    STrack.nextTrackId = startAt;
  }

  public predict(): BoundingBox {
    this.kalman.predict();
    this.age++;
    this.timeSinceUpdate++;
    return this.kalman.toBox();
  }

  public update(detectionBox: BoundingBox, score: number, label?: string, pose?: PoseSkeleton): void {
    this.kalman.update(detectionBox);
    this.box = { ...detectionBox };
    this.score = score;
    if (label) this.label = label;
    if (pose) this.pose = pose;

    this.hits++;
    this.timeSinceUpdate = 0;
    this.state = 'Tracked';
    this.isActivated = true;
    this.lastSeenTimestamp = Date.now();

    // Append center to trajectory breadcrumb (limit history to 40 frames)
    const cx = (detectionBox.xmin + detectionBox.xmax) / 2;
    const cy = (detectionBox.ymin + detectionBox.ymax) / 2;
    this.trajectory.push({ x: cx, y: cy, timestamp: this.lastSeenTimestamp });
    if (this.trajectory.length > 40) {
      this.trajectory.shift();
    }
  }

  public markLost(): void {
    this.state = 'Lost';
  }

  public markRemoved(): void {
    this.state = 'Removed';
  }

  public toTrackedPerson(): TrackedPerson {
    const vx = this.kalman.mean[4];
    const vy = this.kalman.mean[5];
    const speed = Math.sqrt(vx * vx + vy * vy);

    return {
      trackId: this.trackId,
      state: this.state,
      box: { ...this.box },
      score: this.score,
      hits: this.hits,
      age: this.age,
      timeSinceUpdate: this.timeSinceUpdate,
      trajectory: [...this.trajectory],
      velocity: {
        vx,
        vy,
        speed,
      },
      pose: this.pose,
      label: this.label,
      color: this.color,
      lastSeenTimestamp: this.lastSeenTimestamp,
    };
  }
}

/**
 * Calculate Intersection over Union (IoU) between two 0-1000 boxes
 */
export function calculateIoU(boxA: BoundingBox, boxB: BoundingBox): number {
  const x1 = Math.max(boxA.xmin, boxB.xmin);
  const y1 = Math.max(boxA.ymin, boxB.ymin);
  const x2 = Math.min(boxA.xmax, boxB.xmax);
  const y2 = Math.min(boxA.ymax, boxB.ymax);

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const interArea = w * h;

  if (interArea <= 0) return 0;

  const areaA = (boxA.xmax - boxA.xmin) * (boxA.ymax - boxA.ymin);
  const areaB = (boxB.xmax - boxB.xmin) * (boxB.ymax - boxB.ymin);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Greedy Bipartite Matching for IoU Association
 */
export function matchDetectionsToTracks(
  tracks: STrack[],
  detections: Array<{ box: BoundingBox; score: number; label?: string; pose?: PoseSkeleton }>,
  iouThreshold = 0.25
): {
  matches: Array<[number, number]>; // [trackIdx, detIdx]
  unmatchedTracks: number[];
  unmatchedDetections: number[];
} {
  if (tracks.length === 0 || detections.length === 0) {
    return {
      matches: [],
      unmatchedTracks: tracks.map((_, i) => i),
      unmatchedDetections: detections.map((_, i) => i),
    };
  }

  // Cost matrix: 1 - IoU
  const costMatrix: number[][] = tracks.map((track) =>
    detections.map((det) => 1.0 - calculateIoU(track.box, det.box))
  );

  const matchedTrackIndices = new Set<number>();
  const matchedDetIndices = new Set<number>();
  const matches: Array<[number, number]> = [];

  // Pairwise list sorted by highest IoU (lowest cost)
  const pairs: Array<{ trackIdx: number; detIdx: number; cost: number }> = [];
  for (let t = 0; t < tracks.length; t++) {
    for (let d = 0; d < detections.length; d++) {
      if (costMatrix[t][d] < 1.0 - iouThreshold) {
        pairs.push({ trackIdx: t, detIdx: d, cost: costMatrix[t][d] });
      }
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);

  for (const pair of pairs) {
    if (!matchedTrackIndices.has(pair.trackIdx) && !matchedDetIndices.has(pair.detIdx)) {
      matchedTrackIndices.add(pair.trackIdx);
      matchedDetIndices.add(pair.detIdx);
      matches.push([pair.trackIdx, pair.detIdx]);
    }
  }

  const unmatchedTracks: number[] = [];
  for (let t = 0; t < tracks.length; t++) {
    if (!matchedTrackIndices.has(t)) unmatchedTracks.push(t);
  }

  const unmatchedDetections: number[] = [];
  for (let d = 0; d < detections.length; d++) {
    if (!matchedDetIndices.has(d)) unmatchedDetections.push(d);
  }

  return { matches, unmatchedTracks, unmatchedDetections };
}

/**
 * ByteTracker - Complete implementation of ByteTrack
 */
export class ByteTracker {
  private trackedTracks: STrack[] = [];
  private lostTracks: STrack[] = [];
  private frameCount: number = 0;

  // ByteTrack hyper-parameters
  private trackThresh: number; // High detection threshold (default: 0.5)
  private matchThresh: number; // IoU matching threshold (default: 0.3)
  private maxTimeLost: number; // Maximum frames to keep lost tracks (default: 30)

  constructor(trackThresh = 0.5, matchThresh = 0.3, maxTimeLost = 30) {
    this.trackThresh = trackThresh;
    this.matchThresh = matchThresh;
    this.maxTimeLost = maxTimeLost;
  }

  /**
   * Reset tracker state (e.g., when switching video feeds or restarting stream)
   */
  public reset(): void {
    this.trackedTracks = [];
    this.lostTracks = [];
    this.frameCount = 0;
    STrack.resetIdCounter(101);
  }

  /**
   * Main ByteTrack update loop for incoming frame detections
   * @param detections Array of detected bounding boxes with confidence scores
   */
  public update(
    detections: Array<{ box: BoundingBox; score: number; label?: string; pose?: PoseSkeleton }>
  ): TrackedPerson[] {
    this.frameCount++;

    // Step 1: Predict new locations of existing tracks using Kalman filter
    for (const track of this.trackedTracks) {
      track.predict();
    }
    for (const track of this.lostTracks) {
      track.predict();
    }

    // Step 2: Split detections into High Confidence and Low Confidence
    const highDetections: typeof detections = [];
    const lowDetections: typeof detections = [];

    for (const det of detections) {
      if (det.score >= this.trackThresh) {
        highDetections.push(det);
      } else if (det.score >= 0.1) {
        lowDetections.push(det);
      }
    }

    // Candidate pool of existing tracks: confirmed tracked + currently lost
    const poolTracks = [...this.trackedTracks, ...this.lostTracks];

    // ---------------------------------------------------------
    // First Association: Match High-Confidence Detections
    // ---------------------------------------------------------
    const firstMatch = matchDetectionsToTracks(poolTracks, highDetections, this.matchThresh);

    const activatedTracks: STrack[] = [];
    const remainingTracks: STrack[] = [];

    for (const [trackIdx, detIdx] of firstMatch.matches) {
      const track = poolTracks[trackIdx];
      const det = highDetections[detIdx];
      track.update(det.box, det.score, det.label, det.pose);
      activatedTracks.push(track);
    }

    for (const trackIdx of firstMatch.unmatchedTracks) {
      remainingTracks.push(poolTracks[trackIdx]);
    }

    // ---------------------------------------------------------
    // Second Association: Match Remaining Tracks with Low-Confidence Detections
    // (Recovers occluded, motion-blurred, or partial bodies!)
    // ---------------------------------------------------------
    const secondMatch = matchDetectionsToTracks(remainingTracks, lowDetections, 0.2);

    for (const [trackIdx, detIdx] of secondMatch.matches) {
      const track = remainingTracks[trackIdx];
      const det = lowDetections[detIdx];
      track.update(det.box, det.score, det.label, det.pose);
      activatedTracks.push(track);
    }

    // Unmatched tracks after both stages transition to Lost or Removed
    const newLostTracks: STrack[] = [];
    for (const trackIdx of secondMatch.unmatchedTracks) {
      const track = remainingTracks[trackIdx];
      if (track.state !== 'Lost') {
        track.markLost();
      }
      if (track.timeSinceUpdate <= this.maxTimeLost) {
        newLostTracks.push(track);
      } else {
        track.markRemoved();
      }
    }

    // ---------------------------------------------------------
    // Step 3: Initialize New Tracks for Unmatched High-Confidence Detections
    // ---------------------------------------------------------
    for (const detIdx of firstMatch.unmatchedDetections) {
      const det = highDetections[detIdx];
      const newTrack = new STrack(det.box, det.score, det.label || 'Person');
      if (det.pose) newTrack.pose = det.pose;
      newTrack.state = 'Tracked';
      newTrack.isActivated = true;
      activatedTracks.push(newTrack);
    }

    // Update internal track lists
    this.trackedTracks = activatedTracks;
    this.lostTracks = newLostTracks;

    // Return all currently active tracks for rendering
    return this.trackedTracks.map((t) => t.toTrackedPerson());
  }

  /**
   * Get active tracked count and diagnostics
   */
  public getStats() {
    return {
      activeCount: this.trackedTracks.length,
      lostCount: this.lostTracks.length,
      frameCount: this.frameCount,
    };
  }
}
