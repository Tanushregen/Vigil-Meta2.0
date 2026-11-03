export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RuleCategory = 'safety' | 'security' | 'compliance' | 'conduct' | 'quality' | 'custom';
export type StreamType = 'visual' | 'text' | 'both';

export type RuleScope = 'all' | 'group' | 'camera';

export type FeedMode = 'webcam' | 'screen' | 'simulation' | 'video_file';

export interface PromptRule {
  id: string;
  name: string;
  prompt: string; // The natural language prompt rule evaluated by AI
  severity: RuleSeverity;
  category: RuleCategory;
  streamType: StreamType;
  enabled: boolean;
  actionAlarm: boolean;
  actionCapture: boolean;
  detectionCount: number;
  lastTriggeredAt?: string;
  createdAt: string;
  targetScope: RuleScope;
  targetIds?: string[]; // IDs of cameras or groups this rule applies to
}

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  label?: string;
}

export type MetaModelEngine = 'Muse Spark 1.3' | 'Muse Spark 1.2' | 'Muse Spark 1.1';

export interface ViolationIncident {
  id: string;
  ruleId: string;
  ruleName: string;
  rulePrompt: string;
  severity: RuleSeverity;
  category: RuleCategory;
  streamType: StreamType;
  timestamp: string;
  confidence: number; // 0-100
  explanation: string;
  detectedLabel?: string;
  visualEvidence?: string; // Base64 snapshot
  textEvidence?: string;
  box2d?: BoundingBox;
  status: 'active' | 'acknowledged' | 'resolved';
  cameraId?: string;
  cameraName?: string;
  cameraGroup?: string;
  workerId?: string;
  modelEngine?: MetaModelEngine | string;
}

export interface CameraWorker {
  id: string;
  name: string;
  modelEngine: MetaModelEngine;
  status: 'active' | 'scanning' | 'alert' | 'idle';
  fps: number;
  latencyMs: number;
  inspectionsCount: number;
  fieldSupervisor?: string;
}

export interface CameraFeed {
  id: string;
  name: string;
  group: string;
  sourceType: 'simulation' | 'webcam' | 'screen' | 'video_file';
  simulationScenario: 'industrial' | 'proctoring' | 'cleanroom';
  worker: CameraWorker;
  isMonitoring: boolean;
  lastViolationAt?: string;
}

export interface CameraGroup {
  id: string;
  name: string;
  description: string;
  color: string;
}

// ---------------------------------------------------------------------------
// YOLO-Pose & ByteTrack Data Models
// ---------------------------------------------------------------------------

export type KeypointName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle';

export interface PoseKeypoint {
  id: number;
  name: KeypointName;
  x: number; // 0 - 1000 normalized space
  y: number; // 0 - 1000 normalized space
  score: number; // 0.0 - 1.0 confidence
}

export type PosePosture =
  | 'standing'
  | 'walking'
  | 'sitting'
  | 'bending'
  | 'fallen'
  | 'reaching';

export interface PoseSkeleton {
  keypoints: PoseKeypoint[];
  posture: PosePosture;
  postureConfidence: number;
  spineAngleDeg?: number;
  isFallDetected: boolean;
  reachExceeded?: boolean;
}

export type TrackState = 'New' | 'Tracked' | 'Lost' | 'Removed';

export interface TrajectoryPoint {
  x: number; // 0 - 1000 normalized space (center of target)
  y: number; // 0 - 1000 normalized space (center of target)
  timestamp: number;
}

export interface TrackedPerson {
  trackId: number;
  state: TrackState;
  box: BoundingBox; // 0 - 1000 normalized coordinates
  score: number;
  hits: number;
  age: number;
  timeSinceUpdate: number;
  trajectory: TrajectoryPoint[];
  velocity: {
    vx: number;
    vy: number;
    speed: number;
  };
  pose?: PoseSkeleton;
  label: string;
  color: string;
  lastSeenTimestamp: number;
}

export interface TrackingSettings {
  showPoseSkeleton: boolean;
  showByteTrackIds: boolean;
  showTrajectoryTrails: boolean;
  showErgonomicsBadge: boolean;
  minDetectionConfidence: number;
}
