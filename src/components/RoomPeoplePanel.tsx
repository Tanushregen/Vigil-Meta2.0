import React, { useEffect, useState } from 'react';
import { Users, Camera, ShieldAlert } from 'lucide-react';
import type { PersonRegistry } from '../utils/personRegistry';

interface RoomPeoplePanelProps {
  registry: PersonRegistry;
  camNames: Record<string, string>;
}

/** Everyone the room has identified, with the cameras they are on and what is currently flagged for them. */
export const RoomPeoplePanel: React.FC<RoomPeoplePanelProps> = ({ registry, camNames }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const people = registry.list(now).filter((p) => p.active);
  const flagged = people.filter((p) => p.activeViolations.length > 0).length;

  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <Users className="w-4 h-4 text-cyan-400" />
          People in the room
          <span className="text-[10px] font-mono font-normal bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded-full">
            {people.length} active
          </span>
          {flagged > 0 && (
            <span className="text-[10px] font-mono font-normal bg-rose-500/15 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded-full">
              {flagged} flagged
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500">Same ID on every camera, shared with SAM and Muse Spark</span>
      </div>

      {people.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">
          No one identified yet. Set a camera to a webcam or video file and start it.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {people.map((p) => {
            const cams = [...p.sightings.values()].filter((s) => now - s.ts <= 8000);
            return (
              <div
                key={p.gid}
                className={`rounded-lg border px-2.5 py-2 text-[11px] flex flex-col gap-1 ${
                  p.activeViolations.length ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                  <span className="font-bold text-slate-100">{p.label}</span>
                  <span className="text-slate-500 font-mono">{Math.round((now - p.firstSeen) / 1000)}s in room</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap text-slate-300">
                  <Camera className="w-3 h-3 text-slate-500" />
                  {cams.map((s) => (
                    <span key={s.camId} className="font-mono bg-slate-950 border border-slate-800 rounded px-1">
                      {camNames[s.camId] || s.camId}
                      {s.posture ? ` · ${s.posture}` : ''}
                    </span>
                  ))}
                </div>
                {p.activeViolations.map((v) => (
                  <div key={`${v.camId}|${v.ruleId}`} className="flex items-start gap-1 text-rose-300">
                    <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>
                      {v.ruleName} <span className="text-rose-400/70">({camNames[v.camId] || v.camId}, {Math.round((now - v.since) / 1000)}s)</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
