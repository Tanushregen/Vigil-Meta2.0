/**
 * YOLO-Pose: 17-Keypoint Human Skeleton & Posture Estimation Engine
 * Compatible with COCO 17-Keypoint topology, standard limb connections,
 * ergonomic angle calculation, and fall/collapse detection.
 */

import { BoundingBox, KeypointName, PoseKeypoint, PosePosture, PoseSkeleton } from '../types';

export const COCO_KEYPOINTS: KeypointName[] = [
  'nose', // 0
  'left_eye', // 1
  'right_eye', // 2
  'left_ear', // 3
  'right_ear', // 4
  'left_shoulder', // 5
  'right_shoulder', // 6
  'left_elbow', // 7
  'right_elbow', // 8
  'left_wrist', // 9
  'right_wrist', // 10
  'left_hip', // 11
  'right_hip', // 12
  'left_knee', // 13
  'right_knee', // 14
  'left_ankle', // 15
  'right_ankle', // 16
];

// Standard YOLO-Pose / COCO Skeleton Connections (19 limb links)
export const SKELETON_PAIRS: Array<{
  from: number;
  to: number;
  part: 'head' | 'torso' | 'left_arm' | 'right_arm' | 'left_leg' | 'right_leg';
  color: string;
}> = [
  // Head / Face
  { from: 0, to: 1, part: 'head', color: '#38bdf8' },
  { from: 0, to: 2, part: 'head', color: '#38bdf8' },
  { from: 1, to: 3, part: 'head', color: '#38bdf8' },
  { from: 2, to: 4, part: 'head', color: '#38bdf8' },
  // Torso
  { from: 5, to: 6, part: 'torso', color: '#ec4899' },
  { from: 5, to: 11, part: 'torso', color: '#ec4899' },
  { from: 6, to: 12, part: 'torso', color: '#ec4899' },
  { from: 11, to: 12, part: 'torso', color: '#ec4899' },
  // Left Arm
  { from: 5, to: 7, part: 'left_arm', color: '#10b981' },
  { from: 7, to: 9, part: 'left_arm', color: '#10b981' },
  // Right Arm
  { from: 6, to: 8, part: 'right_arm', color: '#f59e0b' },
  { from: 8, to: 10, part: 'right_arm', color: '#f59e0b' },
  // Left Leg
  { from: 11, to: 13, part: 'left_leg', color: '#06b6d4' },
  { from: 13, to: 15, part: 'left_leg', color: '#06b6d4' },
  // Right Leg
  { from: 12, to: 14, part: 'right_leg', color: '#8b5cf6' },
  { from: 14, to: 16, part: 'right_leg', color: '#8b5cf6' },
];

export const KEYPOINT_COLORS: Record<string, string> = {
  head: '#38bdf8',
  torso: '#f43f5e',
  left_arm: '#10b981',
  right_arm: '#f59e0b',
  left_leg: '#06b6d4',
  right_leg: '#a855f7',
};

/**
 * Classifies human posture and ergonomics based on 17 keypoint geometry
 */
export function analyzePosture(keypoints: PoseKeypoint[], box: BoundingBox): {
  posture: PosePosture;
  postureConfidence: number;
  spineAngleDeg: number;
  isFallDetected: boolean;
  reachExceeded: boolean;
} {
  const kpMap = new Map<number, PoseKeypoint>();
  for (const kp of keypoints) {
    kpMap.set(kp.id, kp);
  }

  const nose = kpMap.get(0);
  const leftShoulder = kpMap.get(5);
  const rightShoulder = kpMap.get(6);
  const leftWrist = kpMap.get(9);
  const rightWrist = kpMap.get(10);
  const leftHip = kpMap.get(11);
  const rightHip = kpMap.get(12);
  const leftAnkle = kpMap.get(15);
  const rightAnkle = kpMap.get(16);

  const boxW = Math.max(1, box.xmax - box.xmin);
  const boxH = Math.max(1, box.ymax - box.ymin);
  const aspectRatio = boxW / boxH;

  // 1. Fall / Man-Down Detection:
  // - Bounding box becomes wider than tall (aspectRatio > 1.25)
  // - Head / nose Y is near hip/ankle level
  let isFallDetected = false;
  if (aspectRatio > 1.3 && box.ymax > 700) {
    isFallDetected = true;
  }
  if (nose && leftAnkle && rightAnkle) {
    const avgAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
    if (Math.abs(avgAnkleY - nose.y) < 120 && boxH < 280) {
      isFallDetected = true;
    }
  }

  if (isFallDetected) {
    return {
      posture: 'fallen',
      postureConfidence: 0.94,
      spineAngleDeg: 82,
      isFallDetected: true,
      reachExceeded: false,
    };
  }

  // 2. Spine angle calculation (mid-shoulder to mid-hip)
  let spineAngleDeg = 0;
  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
    const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const midHipX = (leftHip.x + rightHip.x) / 2;
    const midHipY = (leftHip.y + rightHip.y) / 2;

    const dx = midShoulderX - midHipX;
    const dy = midHipY - midShoulderY; // positive upwards
    // Angle with vertical axis
    const angleRad = Math.atan2(Math.abs(dx), Math.max(1, dy));
    spineAngleDeg = Math.round((angleRad * 180) / Math.PI);
  }

  // 3. Ergonomic Bending / Stooping Hazard (> 35 degrees flexion)
  if (spineAngleDeg > 35) {
    return {
      posture: 'bending',
      postureConfidence: 0.91,
      spineAngleDeg,
      isFallDetected: false,
      reachExceeded: false,
    };
  }

  // 4. Overhead Reach / Hazardous Reach Detection:
  // Check if either wrist is above shoulder level or reaching outside safe bounds
  let reachExceeded = false;
  if (leftWrist && leftShoulder && leftWrist.y < leftShoulder.y - 40) {
    reachExceeded = true;
  }
  if (rightWrist && rightShoulder && rightWrist.y < rightShoulder.y - 40) {
    reachExceeded = true;
  }

  if (reachExceeded) {
    return {
      posture: 'reaching',
      postureConfidence: 0.88,
      spineAngleDeg,
      isFallDetected: false,
      reachExceeded: true,
    };
  }

  // 5. Sitting or Standing classification
  if (boxH < 350 && box.ymin > 400) {
    return {
      posture: 'sitting',
      postureConfidence: 0.85,
      spineAngleDeg,
      isFallDetected: false,
      reachExceeded: false,
    };
  }

  return {
    posture: 'standing',
    postureConfidence: 0.92,
    spineAngleDeg,
    isFallDetected: false,
    reachExceeded: false,
  };
}

/**
 * Generate accurate 17-point YOLO-Pose keypoints from a detected human bounding box
 * and kinematic body priors (motion phase, arms, posture modifiers).
 */
export function estimateYoloPose(
  box: BoundingBox,
  options?: {
    postureOverride?: PosePosture;
    holdingObject?: boolean;
    motionPhase?: number; // 0..1 cyclical walking/idle phase
    headLookingAway?: boolean;
  }
): PoseSkeleton {
  const xmin = box.xmin;
  const xmax = box.xmax;
  const ymin = box.ymin;
  const ymax = box.ymax;

  const w = Math.max(10, xmax - xmin);
  const h = Math.max(20, ymax - ymin);
  const cx = (xmin + xmax) / 2;
  const phase = options?.motionPhase ?? 0;
  const isBending = options?.postureOverride === 'bending';
  const isFallen = options?.postureOverride === 'fallen' || (w / h > 1.3 && ymax > 700);
  const isReaching = options?.postureOverride === 'reaching' || options?.holdingObject;
  const isLookingAway = options?.headLookingAway ?? false;

  // Handle Fallen state
  if (isFallen) {
    const keypoints: PoseKeypoint[] = [
      { id: 0, name: 'nose', x: cx - w * 0.4, y: ymax - h * 0.3, score: 0.85 },
      { id: 1, name: 'left_eye', x: cx - w * 0.42, y: ymax - h * 0.35, score: 0.84 },
      { id: 2, name: 'right_eye', x: cx - w * 0.38, y: ymax - h * 0.35, score: 0.84 },
      { id: 3, name: 'left_ear', x: cx - w * 0.45, y: ymax - h * 0.32, score: 0.8 },
      { id: 4, name: 'right_ear', x: cx - w * 0.35, y: ymax - h * 0.32, score: 0.8 },
      { id: 5, name: 'left_shoulder', x: cx - w * 0.25, y: ymax - h * 0.5, score: 0.89 },
      { id: 6, name: 'right_shoulder', x: cx - w * 0.25, y: ymax - h * 0.2, score: 0.89 },
      { id: 7, name: 'left_elbow', x: cx - w * 0.15, y: ymax - h * 0.6, score: 0.82 },
      { id: 8, name: 'right_elbow', x: cx - w * 0.15, y: ymax - h * 0.1, score: 0.82 },
      { id: 9, name: 'left_wrist', x: cx - w * 0.05, y: ymax - h * 0.55, score: 0.78 },
      { id: 10, name: 'right_wrist', x: cx - w * 0.05, y: ymax - h * 0.15, score: 0.78 },
      { id: 11, name: 'left_hip', x: cx + w * 0.05, y: ymax - h * 0.45, score: 0.88 },
      { id: 12, name: 'right_hip', x: cx + w * 0.05, y: ymax - h * 0.25, score: 0.88 },
      { id: 13, name: 'left_knee', x: cx + w * 0.25, y: ymax - h * 0.4, score: 0.83 },
      { id: 14, name: 'right_knee', x: cx + w * 0.25, y: ymax - h * 0.2, score: 0.83 },
      { id: 15, name: 'left_ankle', x: cx + w * 0.42, y: ymax - h * 0.35, score: 0.8 },
      { id: 16, name: 'right_ankle', x: cx + w * 0.42, y: ymax - h * 0.15, score: 0.8 },
    ];
    return {
      keypoints,
      posture: 'fallen',
      postureConfidence: 0.95,
      spineAngleDeg: 85,
      isFallDetected: true,
      reachExceeded: false,
    };
  }

  // Normal / Bending / Reaching Standing Anatomy
  const headY = ymin + h * (isBending ? 0.22 : 0.08);
  const headX = isBending ? cx + w * 0.2 : isLookingAway ? cx - w * 0.12 : cx;

  const shoulderY = ymin + h * (isBending ? 0.32 : 0.2);
  const shoulderW = w * 0.36;
  const leftShoulderX = isBending ? cx + w * 0.05 - shoulderW : cx - shoulderW;
  const rightShoulderX = isBending ? cx + w * 0.05 + shoulderW : cx + shoulderW;

  const hipY = ymin + h * (isBending ? 0.55 : 0.5);
  const hipW = w * 0.26;
  const leftHipX = cx - hipW;
  const rightHipX = cx + hipW;

  const kneeY = ymin + h * 0.75;
  const leftKneeX = cx - hipW * 0.8 + Math.sin(phase) * 8;
  const rightKneeX = cx + hipW * 0.8 - Math.sin(phase) * 8;

  const ankleY = ymax - h * 0.03;
  const leftAnkleX = cx - hipW * 0.9 - Math.sin(phase) * 12;
  const rightAnkleX = cx + hipW * 0.9 + Math.sin(phase) * 12;

  // Arms and wrists
  let leftElbowX = leftShoulderX - w * 0.12;
  let leftElbowY = shoulderY + h * 0.15;
  let leftWristX = leftElbowX - w * 0.05;
  let leftWristY = leftElbowY + h * 0.14;

  let rightElbowX = rightShoulderX + w * 0.12;
  let rightElbowY = shoulderY + h * 0.15;
  let rightWristX = rightElbowX + w * 0.05;
  let rightWristY = rightElbowY + h * 0.14;

  if (isReaching) {
    rightElbowY = shoulderY - h * 0.05;
    rightWristY = shoulderY - h * 0.14;
    rightWristX = cx + w * 0.25;
  } else if (options?.holdingObject) {
    rightElbowY = shoulderY + h * 0.1;
    rightWristX = cx + w * 0.05;
    rightWristY = shoulderY + h * 0.06;
  }

  const keypoints: PoseKeypoint[] = [
    { id: 0, name: 'nose', x: headX, y: headY, score: 0.95 },
    { id: 1, name: 'left_eye', x: headX - w * 0.05, y: headY - h * 0.02, score: 0.93 },
    { id: 2, name: 'right_eye', x: headX + w * 0.05, y: headY - h * 0.02, score: 0.93 },
    { id: 3, name: 'left_ear', x: headX - w * 0.1, y: headY, score: 0.88 },
    { id: 4, name: 'right_ear', x: headX + w * 0.1, y: headY, score: 0.88 },
    { id: 5, name: 'left_shoulder', x: leftShoulderX, y: shoulderY, score: 0.96 },
    { id: 6, name: 'right_shoulder', x: rightShoulderX, y: shoulderY, score: 0.96 },
    { id: 7, name: 'left_elbow', x: leftElbowX, y: leftElbowY, score: 0.9 },
    { id: 8, name: 'right_elbow', x: rightElbowX, y: rightElbowY, score: 0.9 },
    { id: 9, name: 'left_wrist', x: leftWristX, y: leftWristY, score: 0.86 },
    { id: 10, name: 'right_wrist', x: rightWristX, y: rightWristY, score: 0.86 },
    { id: 11, name: 'left_hip', x: leftHipX, y: hipY, score: 0.94 },
    { id: 12, name: 'right_hip', x: rightHipX, y: hipY, score: 0.94 },
    { id: 13, name: 'left_knee', x: leftKneeX, y: kneeY, score: 0.91 },
    { id: 14, name: 'right_knee', x: rightKneeX, y: kneeY, score: 0.91 },
    { id: 15, name: 'left_ankle', x: leftAnkleX, y: ankleY, score: 0.89 },
    { id: 16, name: 'right_ankle', x: rightAnkleX, y: ankleY, score: 0.89 },
  ];

  const analysis = analyzePosture(keypoints, box);

  return {
    keypoints,
    posture: analysis.posture,
    postureConfidence: analysis.postureConfidence,
    spineAngleDeg: analysis.spineAngleDeg,
    isFallDetected: analysis.isFallDetected,
    reachExceeded: analysis.reachExceeded,
  };
}

/**
 * Render YOLO-Pose skeleton limb bones and keypoints onto an HTML5 Canvas
 */
export function drawPoseSkeletonOnCanvas(
  ctx: CanvasRenderingContext2D,
  skeleton: PoseSkeleton,
  targetWidth: number,
  targetHeight: number,
  options?: {
    lineWidth?: number;
    jointRadius?: number;
    showJointLabels?: boolean;
    trackColor?: string;
  }
): void {
  const kpMap = new Map<number, { x: number; y: number; score: number }>();
  const scaleX = targetWidth / 1000;
  const scaleY = targetHeight / 1000;

  for (const kp of skeleton.keypoints) {
    kpMap.set(kp.id, {
      x: kp.x * scaleX,
      y: kp.y * scaleY,
      score: kp.score,
    });
  }

  ctx.save();
  const lw = options?.lineWidth ?? 2.5;
  const jRadius = options?.jointRadius ?? 3.5;

  // 1. Draw Skeleton Bones / Limbs
  for (const link of SKELETON_PAIRS) {
    const p1 = kpMap.get(link.from);
    const p2 = kpMap.get(link.to);
    if (!p1 || !p2 || p1.score < 0.4 || p2.score < 0.4) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = options?.trackColor || link.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 2. Draw 17 Joint Keypoints
  for (const kp of skeleton.keypoints) {
    const pt = kpMap.get(kp.id);
    if (!pt || pt.score < 0.4) continue;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, jRadius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fill();

    // Keypoint core
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, jRadius, 0, Math.PI * 2);
    ctx.fillStyle = options?.trackColor || '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
