import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Play, User, Smartphone, Eye, Sparkles, Activity, ShieldAlert, Users } from 'lucide-react';
import { BoundingBox, PosePosture } from '../types';

export interface DetectedEntity {
  box: BoundingBox;
  score: number;
  label: string;
  postureHint?: PosePosture;
  holdingObject?: boolean;
  motionPhase?: number;
  headLookingAway?: boolean;
}

export interface SimulationHandle {
  captureFrame: () => string | null;
  getConditionsContext: () => string;
  clearCanvas: () => void;
  getPeopleDetections: () => DetectedEntity[];
}

interface SimulationCanvasProps {
  onViolationConditionChange?: (conditionContext: string) => void;
}

export const SimulationCanvas = forwardRef<SimulationHandle, SimulationCanvasProps>(
  ({ onViolationConditionChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Simulation states
    const [scenario, setScenario] = useState<'industrial' | 'proctoring' | 'cleanroom'>('industrial');
    const [hasHardhat, setHasHardhat] = useState<boolean>(false); // Starts violated (no hardhat)
    const [hasVest, setHasVest] = useState<boolean>(true);
    const [holdingPhone, setHoldingPhone] = useState<boolean>(false);
    const [candidatePresent, setCandidatePresent] = useState<boolean>(true);
    const [lookingAway, setLookingAway] = useState<boolean>(false);
    const [secondPerson, setSecondPerson] = useState<boolean>(false);
    const [hasHairnet, setHasHairnet] = useState<boolean>(false);

    // Dynamic Human Posture & Multi-Person Tracking states
    const [workerPosture, setWorkerPosture] = useState<PosePosture>('standing');
    const [secondWorkerActive, setSecondWorkerActive] = useState<boolean>(false);

    // Animation frame ref
    const animRef = useRef<number | null>(null);
    const tickRef = useRef<number>(0);
    const entitiesRef = useRef<DetectedEntity[]>([]);

    const getContextString = (
      scen = scenario,
      hHat = hasHardhat,
      vst = hasVest,
      phone = holdingPhone,
      cand = candidatePresent,
      away = lookingAway,
      second = secondPerson,
      hair = hasHairnet,
      posture = workerPosture,
      secondW = secondWorkerActive
    ) => {
      const parts: string[] = [`Scenario: ${scen}`];
      if (scen === 'industrial') {
        parts.push(hHat ? 'hardhat worn' : 'no hardhat (violation)');
        parts.push(vst ? 'vest on' : 'missing vest (violation)');
        parts.push(phone ? 'cell phone in hand (violation)' : 'no phone in hand');
        if (posture === 'bending') parts.push('worker bending forward (ergonomic hazard)');
        if (posture === 'fallen') parts.push('man down worker fallen on ground (emergency)');
        if (secondW) parts.push('second worker on site (multi-person tracking)');
      } else if (scen === 'proctoring') {
        parts.push(cand ? 'candidate seated' : 'candidate absent vacant seat (violation)');
        parts.push(phone ? 'smartphone in hand on desk (violation)' : 'no phone');
        parts.push(away ? 'gaze off screen looking away (violation)' : 'gaze focused');
        parts.push(second ? 'second unauthorized person present (violation)' : 'single person');
      } else if (scen === 'cleanroom') {
        parts.push(hair ? 'hairnet on' : 'uncovered hair missing hairnet (violation)');
      }
      return parts.join(', ');
    };

    // Expose captureFrame, getConditionsContext, clearCanvas & getPeopleDetections to parent
    useImperativeHandle(ref, () => ({
      captureFrame: () => {
        if (!canvasRef.current) return null;
        try {
          return canvasRef.current.toDataURL('image/jpeg', 0.85);
        } catch (e) {
          console.error('Failed to capture canvas frame', e);
          return null;
        }
      },
      getConditionsContext: () => {
        return getContextString();
      },
      clearCanvas: () => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      },
      getPeopleDetections: () => {
        return entitiesRef.current;
      },
    }));

    // Trigger initial condition change notification on mount
    useEffect(() => {
      onViolationConditionChange?.(getContextString());
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let isMounted = true;

      const render = () => {
        if (!isMounted) return;
        tickRef.current += 0.03;
        const tick = tickRef.current;
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);
        const currentEntities: DetectedEntity[] = [];

        if (scenario === 'industrial') {
          // Industrial Construction Zone
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, '#1e293b');
          grad.addColorStop(0.6, '#334155');
          grad.addColorStop(1, '#0f172a');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, width, height);

          // Scaffolding & structural girders in background
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(60, height - 100);
          ctx.lineTo(60, 60);
          ctx.lineTo(200, 60);
          ctx.lineTo(200, height - 100);
          ctx.moveTo(60, 140);
          ctx.lineTo(200, 200);
          ctx.moveTo(200, 140);
          ctx.lineTo(60, 200);
          ctx.stroke();

          // Crane tower in background
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 2;
          ctx.strokeRect(480, 40, 50, height - 140);
          ctx.beginPath();
          ctx.moveTo(450, 40);
          ctx.lineTo(620, 40);
          ctx.stroke();

          // Floor / ground with safety hazard stripes
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, height - 100, width, 100);

          const stripeW = 24;
          for (let x = 0; x < width; x += stripeW * 2) {
            ctx.fillStyle = '#eab308';
            ctx.beginPath();
            ctx.moveTo(x, height - 100);
            ctx.lineTo(x + stripeW, height - 100);
            ctx.lineTo(x + stripeW - 12, height - 85);
            ctx.lineTo(x - 12, height - 85);
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.moveTo(x + stripeW, height - 100);
            ctx.lineTo(x + stripeW * 2, height - 100);
            ctx.lineTo(x + stripeW * 2 - 12, height - 85);
            ctx.lineTo(x - 12, height - 85);
            ctx.fill();
          }

          // Safety Signboard
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(20, 20, 175, 48);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.fillText('SAFETY ZONE: PPE REQUIRED', 26, 38);
          ctx.font = '9px system-ui, sans-serif';
          ctx.fillText('HARD HAT & HI-VIS MANDATORY', 26, 54);

          // Primary Worker coordinates
          const workerX = 320 + Math.sin(tick * 0.5) * 10;
          const workerY = height - 100;

          if (workerPosture === 'fallen') {
            // Fallen / Collapse posture: worker lying horizontally on ground
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(workerX - 70, workerY - 25, 75, 20); // legs
            ctx.fillStyle = '#334155';
            ctx.fillRect(workerX + 5, workerY - 30, 60, 25); // torso
            if (hasVest) {
              ctx.fillStyle = '#22c55e';
              ctx.fillRect(workerX + 5, workerY - 30, 60, 25);
            }
            // Head on ground
            ctx.fillStyle = '#fed7aa';
            ctx.beginPath();
            ctx.arc(workerX + 80, workerY - 18, 16, 0, Math.PI * 2);
            ctx.fill();
            if (hasHardhat) {
              ctx.fillStyle = '#facc15';
              ctx.beginPath();
              ctx.arc(workerX + 80, workerY - 22, 18, Math.PI, 0);
              ctx.fill();
            }

            // Emergency alert label
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('🚨 MAN DOWN / FALLEN WORKER', workerX - 60, workerY - 50);

            // Bounding box for fallen worker
            const minX = Math.round(((workerX - 90) / width) * 1000);
            const maxX = Math.round(((workerX + 110) / width) * 1000);
            const minY = Math.round(((workerY - 60) / height) * 1000);
            const maxY = Math.round(((workerY + 5) / height) * 1000);

            currentEntities.push({
              box: { ymin: minY, xmin: minX, ymax: maxY, xmax: maxX },
              score: 0.94,
              label: 'Worker (Fallen)',
              postureHint: 'fallen',
              motionPhase: tick,
            });
          } else if (workerPosture === 'bending') {
            // Bending forward posture: worker stooping over machinery/toolbox
            // Legs
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(workerX - 16, workerY - 80, 14, 70);
            ctx.fillRect(workerX + 4, workerY - 80, 14, 70);
            // Angled torso bending right
            ctx.save();
            ctx.translate(workerX, workerY - 80);
            ctx.rotate(0.55); // ~32 degree forward bend
            ctx.fillStyle = hasVest ? '#22c55e' : '#334155';
            ctx.fillRect(-20, -75, 45, 75);
            // Head
            ctx.fillStyle = '#fed7aa';
            ctx.beginPath();
            ctx.arc(2, -90, 18, 0, Math.PI * 2);
            ctx.fill();
            if (hasHardhat) {
              ctx.fillStyle = '#facc15';
              ctx.beginPath();
              ctx.arc(2, -96, 20, Math.PI, 0);
              ctx.fill();
            }
            ctx.restore();

            // Toolbox
            ctx.fillStyle = '#b91c1c';
            ctx.fillRect(workerX + 45, workerY - 35, 45, 30);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(workerX + 60, workerY - 40, 15, 6);

            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 10px monospace';
            ctx.fillText('⚠️ ERGONOMIC BEND RISK', workerX - 40, workerY - 140);

            const minX = Math.round(((workerX - 45) / width) * 1000);
            const maxX = Math.round(((workerX + 85) / width) * 1000);
            const minY = Math.round(((workerY - 150) / height) * 1000);
            const maxY = Math.round(((workerY) / height) * 1000);

            currentEntities.push({
              box: { ymin: minY, xmin: minX, ymax: maxY, xmax: maxX },
              score: 0.92,
              label: 'Worker (Bending)',
              postureHint: 'bending',
              holdingObject: holdingPhone,
              motionPhase: tick,
            });
          } else {
            // Normal Standing Worker
            // Legs & boots
            ctx.fillStyle = '#1e3a8a';
            ctx.fillRect(workerX - 18, workerY - 110, 14, 90);
            ctx.fillRect(workerX + 4, workerY - 110, 14, 90);

            // Boots
            ctx.fillStyle = '#78350f';
            ctx.fillRect(workerX - 22, workerY - 20, 20, 20);
            ctx.fillRect(workerX + 2, workerY - 20, 20, 20);

            // Torso
            ctx.fillStyle = '#334155';
            ctx.fillRect(workerX - 26, workerY - 190, 52, 85);

            // High-vis safety vest
            if (hasVest) {
              ctx.fillStyle = '#22c55e'; // Bright neon safety green
              ctx.fillRect(workerX - 26, workerY - 190, 52, 80);
              ctx.fillStyle = '#e2e8f0';
              ctx.fillRect(workerX - 26, workerY - 170, 52, 10);
              ctx.fillRect(workerX - 26, workerY - 140, 52, 10);
              ctx.fillRect(workerX - 16, workerY - 190, 8, 80);
              ctx.fillRect(workerX + 8, workerY - 190, 8, 80);
            } else {
              // Missing vest marker
              ctx.fillStyle = '#ef4444';
              ctx.font = 'bold 10px monospace';
              ctx.fillText('⚠️ NO VEST', workerX - 25, workerY - 95);
            }

            // Arms & Phone in Hand
            ctx.fillStyle = '#fed7aa'; // Skin tone
            ctx.fillRect(workerX - 38, workerY - 180, 12, 60);

            if (holdingPhone) {
              // Arm bent holding smartphone up
              ctx.fillRect(workerX + 26, workerY - 180, 12, 35);
              ctx.fillRect(workerX + 26, workerY - 150, 30, 12);
              // Smartphone in hand
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(workerX + 54, workerY - 175, 16, 32);
              // Glowing screen
              ctx.fillStyle = '#38bdf8';
              ctx.fillRect(workerX + 56, workerY - 172, 12, 26);

              // Clear visual tag on canvas
              ctx.fillStyle = '#ef4444';
              ctx.font = 'bold 11px monospace';
              ctx.fillText('⚠️ CELL PHONE IN HAND', workerX + 35, workerY - 185);
            } else {
              // Straight arm holding wrench/clipboard
              ctx.fillRect(workerX + 26, workerY - 180, 12, 60);
              ctx.fillStyle = '#94a3b8';
              ctx.fillRect(workerX + 28, workerY - 120, 8, 25);
            }

            // Head & Face
            const headY = workerY - 225;
            ctx.fillStyle = '#fed7aa';
            ctx.beginPath();
            ctx.arc(workerX, headY, 22, 0, Math.PI * 2);
            ctx.fill();

            // Facial features
            ctx.fillStyle = '#475569';
            ctx.fillRect(workerX - 8, headY - 4, 4, 4);
            ctx.fillRect(workerX + 4, headY - 4, 4, 4);
            ctx.beginPath();
            ctx.arc(workerX, headY + 7, 7, 0, Math.PI);
            ctx.stroke();

            // Hardhat or Bare Hair
            if (hasHardhat) {
              // Bright Yellow OSHA Safety Helmet
              ctx.fillStyle = '#facc15';
              ctx.beginPath();
              ctx.arc(workerX, headY - 8, 24, Math.PI, 0, false);
              ctx.fill();
              ctx.fillRect(workerX - 30, headY - 10, 60, 6);
              ctx.fillStyle = '#ca8a04';
              ctx.fillRect(workerX - 4, headY - 26, 8, 16);
            } else {
              // Unprotected hair (VIOLATION)
              ctx.fillStyle = '#451a03';
              ctx.beginPath();
              ctx.arc(workerX, headY - 6, 22, Math.PI * 0.9, Math.PI * 2.1, false);
              ctx.fill();
              ctx.fillStyle = '#ef4444';
              ctx.font = 'bold 11px monospace';
              ctx.fillText('⚠️ NO HARDHAT', workerX - 44, headY - 34);
            }

            // Push Worker 1 bounding box for ByteTrack & YOLO-Pose
            const minX = Math.round(((workerX - 45) / width) * 1000);
            const maxX = Math.round(((workerX + 45) / width) * 1000);
            const minY = Math.round(((workerY - 245) / height) * 1000);
            const maxY = Math.round((workerY / height) * 1000);

            currentEntities.push({
              box: { ymin: minY, xmin: minX, ymax: maxY, xmax: maxX },
              score: 0.96,
              label: 'Worker #1',
              postureHint: 'standing',
              holdingObject: holdingPhone,
              motionPhase: tick,
            });
          }

          // Second Worker: Walking across scene to test ByteTrack Multi-Person Persistent IDs
          if (secondWorkerActive) {
            // Smooth horizontal walk cycle traversing the screen
            const cycle = (tick * 45) % (width + 160);
            const w2X = cycle - 80;
            const w2Y = height - 100;
            const legSwing = Math.sin(tick * 3.5) * 16;

            // Legs
            ctx.fillStyle = '#334155';
            ctx.fillRect(w2X - 14 + legSwing, w2Y - 95, 12, 75);
            ctx.fillRect(w2X + 2 - legSwing, w2Y - 95, 12, 75);
            // Torso in blue safety gear
            ctx.fillStyle = '#0284c7';
            ctx.fillRect(w2X - 22, w2Y - 170, 44, 75);
            // Reflective stripes
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(w2X - 22, w2Y - 145, 44, 8);
            // Head
            ctx.fillStyle = '#fed7aa';
            ctx.beginPath();
            ctx.arc(w2X, w2Y - 200, 18, 0, Math.PI * 2);
            ctx.fill();
            // White hardhat
            ctx.fillStyle = '#f8fafc';
            ctx.beginPath();
            ctx.arc(w2X, w2Y - 206, 20, Math.PI, 0);
            ctx.fill();
            ctx.fillRect(w2X - 24, w2Y - 208, 48, 5);

            // Bounding box for Worker 2
            if (w2X > -40 && w2X < width + 40) {
              const minX2 = Math.max(0, Math.min(1000, Math.round(((w2X - 35) / width) * 1000)));
              const maxX2 = Math.max(0, Math.min(1000, Math.round(((w2X + 35) / width) * 1000)));
              const minY2 = Math.round(((w2Y - 220) / height) * 1000);
              const maxY2 = Math.round((w2Y / height) * 1000);

              currentEntities.push({
                box: { ymin: minY2, xmin: minX2, ymax: maxY2, xmax: maxX2 },
                score: 0.93,
                label: 'Worker #2',
                postureHint: 'walking',
                motionPhase: tick * 3,
              });
            }
          }
        } else if (scenario === 'proctoring') {
          // Remote Exam Room Proctoring Scenario
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, width, height);

          const wallGrad = ctx.createLinearGradient(0, 0, width, height);
          wallGrad.addColorStop(0, '#1e293b');
          wallGrad.addColorStop(1, '#0b0f19');
          ctx.fillStyle = wallGrad;
          ctx.fillRect(0, 0, width, height - 120);

          // Desk
          ctx.fillStyle = '#334155';
          ctx.fillRect(40, height - 120, width - 80, 120);
          ctx.fillStyle = '#475569';
          ctx.fillRect(40, height - 120, width - 80, 10);

          // Laptop on desk
          const laptopX = 260;
          const laptopY = height - 110;
          ctx.fillStyle = '#64748b';
          ctx.fillRect(laptopX - 60, laptopY - 6, 120, 8);
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(laptopX - 50, laptopY - 70, 100, 65);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(laptopX - 46, laptopY - 66, 92, 57);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('ONLINE EXAM PORTAL', laptopX - 40, laptopY - 45);

          // Candidate Chair
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(laptopX - 35, height - 210, 70, 100);

          if (candidatePresent) {
            const headX = lookingAway ? laptopX + 45 : laptopX;
            const headY = height - 230;

            // Torso
            ctx.fillStyle = '#4f46e5';
            ctx.fillRect(laptopX - 30, height - 190, 60, 80);

            // Hands on desk
            ctx.fillStyle = '#fed7aa';
            if (holdingPhone) {
              // Holding phone up
              ctx.fillRect(laptopX + 35, height - 130, 20, 20);
              ctx.fillStyle = '#020617';
              ctx.fillRect(laptopX + 50, height - 165, 22, 42);
              ctx.fillStyle = '#a855f7';
              ctx.fillRect(laptopX + 52, height - 161, 18, 34);

              ctx.fillStyle = '#ef4444';
              ctx.font = 'bold 11px monospace';
              ctx.fillText('⚠️ SMARTPHONE IN HAND', laptopX + 25, height - 175);
            } else {
              ctx.fillRect(laptopX - 35, height - 110, 20, 15);
              ctx.fillRect(laptopX + 15, height - 110, 20, 15);
            }

            // Head
            ctx.fillStyle = '#fed7aa';
            ctx.beginPath();
            ctx.arc(headX, headY, 26, 0, Math.PI * 2);
            ctx.fill();

            // Hair
            ctx.fillStyle = '#1f2937';
            ctx.beginPath();
            ctx.arc(headX, headY - 6, 26, Math.PI * 0.8, Math.PI * 2.2);
            ctx.fill();

            // Gaze direction
            ctx.fillStyle = '#0f172a';
            if (lookingAway) {
              ctx.fillRect(headX + 12, headY - 4, 5, 5);
              ctx.fillStyle = '#ef4444';
              ctx.font = 'bold 11px monospace';
              ctx.fillText('⚠️ GAZE OFF-SCREEN', headX + 15, headY - 35);
            } else {
              ctx.fillRect(headX - 10, headY, 5, 4);
              ctx.fillRect(headX + 5, headY, 5, 4);
            }

            // Bounding box for Candidate
            const minX = Math.round(((laptopX - 50) / width) * 1000);
            const maxX = Math.round(((laptopX + (holdingPhone ? 75 : 50)) / width) * 1000);
            const minY = Math.round(((headY - 35) / height) * 1000);
            const maxY = Math.round(((height - 110) / height) * 1000);

            currentEntities.push({
              box: { ymin: minY, xmin: minX, ymax: maxY, xmax: maxX },
              score: 0.95,
              label: 'Candidate',
              postureHint: 'sitting',
              holdingObject: holdingPhone,
              headLookingAway: lookingAway,
            });
          } else {
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 14px monospace';
            ctx.fillText('⚠️ CANDIDATE ABSENT / DESK VACANT', laptopX - 110, height - 160);
          }

          if (secondPerson) {
            const sX = laptopX + 130;
            const sY = height - 250;
            ctx.fillStyle = '#7c2d12';
            ctx.fillRect(sX - 25, sY + 20, 50, 90);
            ctx.fillStyle = '#fde047';
            ctx.beginPath();
            ctx.arc(sX, sY, 22, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('⚠️ UNAUTHORIZED PERSON', sX - 50, sY - 30);

            const minX2 = Math.round(((sX - 35) / width) * 1000);
            const maxX2 = Math.round(((sX + 35) / width) * 1000);
            const minY2 = Math.round(((sY - 30) / height) * 1000);
            const maxY2 = Math.round(((sY + 110) / height) * 1000);

            currentEntities.push({
              box: { ymin: minY2, xmin: minX2, ymax: maxY2, xmax: maxX2 },
              score: 0.88,
              label: 'Unauthorized Person',
              postureHint: 'standing',
            });
          }
        } else {
          // Cleanroom / Food Prep Hygiene
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(0, 0, width, height);

          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(0, height - 120, width, 120);
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(0, height - 120, width, 15);

          const opX = width / 2;
          const opY = height - 120;

          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(opX - 35, opY - 140, 70, 140);
          ctx.strokeStyle = '#94a3b8';
          ctx.strokeRect(opX - 35, opY - 140, 70, 140);

          const headY = opY - 180;
          ctx.fillStyle = '#fed7aa';
          ctx.beginPath();
          ctx.arc(opX, headY, 24, 0, Math.PI * 2);
          ctx.fill();

          if (hasHairnet) {
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(opX, headY - 6, 26, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#0284c7';
            ctx.font = 'bold 10px monospace';
            ctx.fillText('HAIRNET ON', opX - 28, headY - 32);
          } else {
            ctx.fillStyle = '#78350f';
            ctx.beginPath();
            ctx.arc(opX, headY - 6, 25, Math.PI * 0.9, Math.PI * 2.1);
            ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('⚠️ UNCOVERED HAIR / NO NET', opX - 65, headY - 32);
          }

          const minX = Math.round(((opX - 45) / width) * 1000);
          const maxX = Math.round(((opX + 45) / width) * 1000);
          const minY = Math.round(((headY - 35) / height) * 1000);
          const maxY = Math.round((opY / height) * 1000);

          currentEntities.push({
            box: { ymin: minY, xmin: minX, ymax: maxY, xmax: maxX },
            score: 0.95,
            label: 'Cleanroom Operator',
            postureHint: 'standing',
          });
        }

        // Watermark HUD timestamp overlay on canvas
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(width - 170, 12, 158, 26);
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 11px monospace';
        const now = new Date();
        ctx.fillText(`SIMULATOR: ${now.toTimeString().split(' ')[0]}`, width - 162, 29);

        // Store active entities for ByteTrack & YOLO-Pose
        entitiesRef.current = currentEntities;

        animRef.current = requestAnimationFrame(render);
      };

      animRef.current = requestAnimationFrame(render);

      return () => {
        isMounted = false;
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }, [
      scenario,
      hasHardhat,
      hasVest,
      holdingPhone,
      candidatePresent,
      lookingAway,
      secondPerson,
      hasHairnet,
      workerPosture,
      secondWorkerActive,
    ]);

    return (
      <div className="flex flex-col gap-3">
        {/* Canvas Display */}
        <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl aspect-video w-full max-h-[460px]">
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="w-full h-full object-cover"
          />

          {/* Interactive Simulation Controls Overlay */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-200">Interactive Test Environment:</span>
            <select
              value={scenario}
              onChange={(e) => {
                const nextScen = e.target.value as any;
                setScenario(nextScen);
                const ctx = getContextString(nextScen);
                onViolationConditionChange?.(ctx);
              }}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="industrial">Industrial Safety / OSHA</option>
              <option value="proctoring">Exam Proctoring / Desk</option>
              <option value="cleanroom">Cleanroom / Food Hygiene</option>
            </select>
          </div>
        </div>

        {/* Live Violation Injection & Multi-Person Controls */}
        <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-medium text-slate-300">Live Test Scenario Toggles:</span>
            <span className="text-[11px] text-slate-500">(Test ByteTrack Multi-Person & YOLO-Pose Posture)</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {scenario === 'industrial' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const next = !hasHardhat;
                    setHasHardhat(next);
                    const ctx = getContextString(
                      scenario,
                      next,
                      hasVest,
                      holdingPhone,
                      candidatePresent,
                      lookingAway,
                      secondPerson,
                      hasHairnet,
                      workerPosture,
                      secondWorkerActive
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    !hasHardhat
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                  }`}
                >
                  Hardhat: {hasHardhat ? 'Worn (Compliant)' : 'Missing (Violation)'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !hasVest;
                    setHasVest(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      next,
                      holdingPhone,
                      candidatePresent,
                      lookingAway,
                      secondPerson,
                      hasHairnet,
                      workerPosture,
                      secondWorkerActive
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    !hasVest
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  Vest: {hasVest ? 'Neon Vest ON' : 'Vest OFF (Violation)'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !holdingPhone;
                    setHoldingPhone(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      next,
                      candidatePresent,
                      lookingAway,
                      secondPerson,
                      hasHairnet,
                      workerPosture,
                      secondWorkerActive
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    holdingPhone
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30 font-bold'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  <Smartphone className="w-3 h-3 inline mr-1" />
                  Cell Phone: {holdingPhone ? 'In Hand (Violation)' : 'Put Away'}
                </button>

                {/* YOLO-Pose Posture Selector: Standing / Bending / Fallen */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-md border border-slate-700 text-[11px]">
                  <Activity className="w-3 h-3 text-cyan-400 ml-1.5" />
                  <span className="text-slate-400 font-medium px-1">YOLO-Pose:</span>
                  {(['standing', 'bending', 'fallen'] as PosePosture[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setWorkerPosture(p);
                        const ctx = getContextString(
                          scenario,
                          hasHardhat,
                          hasVest,
                          holdingPhone,
                          candidatePresent,
                          lookingAway,
                          secondPerson,
                          hasHairnet,
                          p,
                          secondWorkerActive
                        );
                        onViolationConditionChange?.(ctx);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] capitalize font-medium transition-colors cursor-pointer ${
                        workerPosture === p
                          ? p === 'fallen'
                            ? 'bg-rose-500 text-white font-bold'
                            : p === 'bending'
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-cyan-500 text-slate-950 font-bold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                {/* ByteTrack Multi-Person Cross Traffic toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !secondWorkerActive;
                    setSecondWorkerActive(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      holdingPhone,
                      candidatePresent,
                      lookingAway,
                      secondPerson,
                      hasHairnet,
                      workerPosture,
                      next
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                    secondWorkerActive
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Users className="w-3 h-3" />
                  +2nd Worker ({secondWorkerActive ? 'Active' : 'Off'})
                </button>
              </>
            )}

            {scenario === 'proctoring' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const next = !holdingPhone;
                    setHoldingPhone(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      next,
                      candidatePresent,
                      lookingAway,
                      secondPerson,
                      hasHairnet
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    holdingPhone
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  <Smartphone className="w-3 h-3 inline mr-1" />
                  Phone: {holdingPhone ? 'Visible (Violation)' : 'None'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !lookingAway;
                    setLookingAway(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      holdingPhone,
                      candidatePresent,
                      next,
                      secondPerson,
                      hasHairnet
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    lookingAway
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  <Eye className="w-3 h-3 inline mr-1" />
                  Gaze: {lookingAway ? 'Looking Away (Violation)' : 'On Screen'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !secondPerson;
                    setSecondPerson(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      holdingPhone,
                      candidatePresent,
                      lookingAway,
                      next,
                      hasHairnet
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    secondPerson
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  <User className="w-3 h-3 inline mr-1" />
                  Second Person: {secondPerson ? 'Detected (Violation)' : 'None'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !candidatePresent;
                    setCandidatePresent(next);
                    const ctx = getContextString(
                      scenario,
                      hasHardhat,
                      hasVest,
                      holdingPhone,
                      next,
                      lookingAway,
                      secondPerson,
                      hasHairnet
                    );
                    onViolationConditionChange?.(ctx);
                  }}
                  className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    !candidatePresent
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  Seat: {candidatePresent ? 'Seated' : 'Empty (Abandonment)'}
                </button>
              </>
            )}

            {scenario === 'cleanroom' && (
              <button
                type="button"
                onClick={() => {
                  const next = !hasHairnet;
                  setHasHairnet(next);
                  const ctx = getContextString(
                    scenario,
                    hasHardhat,
                    hasVest,
                    holdingPhone,
                    candidatePresent,
                    lookingAway,
                    secondPerson,
                    next
                  );
                  onViolationConditionChange?.(ctx);
                }}
                className={`px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                  !hasHairnet
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                Hairnet: {hasHairnet ? 'Compliant' : 'Missing (Violation)'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);
