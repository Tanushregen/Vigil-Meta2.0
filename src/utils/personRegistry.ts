/**
 * Room-wide person registry. Every camera runs its own detector + tracker (local track IDs); this registry links those
 * local tracks to one GLOBAL person ID using appearance embeddings (see reid.ts), so the same person keeps the same ID
 * and colour on every camera. It also remembers each person's sightings and violations across cameras, which is the
 * context handed to SAM and Muse Spark so they judge a person, not an isolated frame.
 *
 * Pure TypeScript (no DOM, no ONNX), so it can be tested directly.
 */

import { cosine } from './reid';

/** Minimum cosine similarity for a track to be linked to an existing person. */
export const MATCH_THRESHOLD = 0.7;
/** If the runner-up person is within this of the best, the match is ambiguous and a new person is created instead. */
export const MATCH_MARGIN = 0.04;
/** Embeddings kept per person (diverse views make cross-camera matching more robust). */
export const GALLERY_SIZE = 8;
/** A new embedding closer than this to an existing gallery entry just refreshes it instead of taking a new slot. */
const GALLERY_DUPLICATE_SIM = 0.92;
/** A person seen within this many ms counts as currently active in the room. */
export const ACTIVE_WINDOW_MS = 8000;
const FORGET_AFTER_MS = 10 * 60 * 1000;
const MAX_PEOPLE = 100;
/** People seen for less than GHOST_MAX_SEEN_MS and gone for GHOST_AFTER_MS are dropped as false detections */
const GHOST_MAX_SEEN_MS = 4000;
const GHOST_AFTER_MS = 15000;

export const PERSON_COLORS = [
  '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#a855f7', '#6366f1',
];

export interface TrackObservation {
  trackId: number;
  /** Appearance fingerprint; null until one has been computed for this track */
  embedding: Float32Array | null;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
  posture?: string;
  /**
   * Whether this track is stable enough to become a NEW person. Short-lived or flickering detections can still be
   * matched to someone already known, but must not mint new IDs. Defaults to true.
   */
  canCreate?: boolean;
}

export interface Sighting {
  camId: string;
  trackId: number;
  box: TrackObservation['box'];
  posture?: string;
  ts: number;
}

export interface ViolationRecord {
  ruleId: string;
  ruleName: string;
  severity: string;
  explanation: string;
  camId: string;
  since: number;
  lastSeen: number;
  active: boolean;
  resolvedAt?: number;
}

export interface GlobalPerson {
  gid: number;
  label: string;
  color: string;
  gallery: Float32Array[];
  firstSeen: number;
  lastSeen: number;
  /** Latest sighting per camera */
  sightings: Map<string, Sighting>;
  /** Key: `${camId}|${ruleId}` */
  violations: Map<string, ViolationRecord>;
}

export class PersonRegistry {
  private people = new Map<number, GlobalPerson>();
  /** camId -> (local trackId -> gid) */
  private links = new Map<string, Map<number, number>>();
  private nextGid = 1;

  /**
   * Feed one camera's current tracks. Returns local trackId -> global ID for every track that could be identified.
   * Tracks without an embedding yet (and not already linked) are left unidentified until one is available.
   */
  observe(camId: string, tracks: TrackObservation[], now: number): Map<number, number> {
    const camLinks = this.links.get(camId) ?? new Map<number, number>();
    this.links.set(camId, camLinks);

    // Forget links for tracks that are gone from this camera
    const present = new Set(tracks.map((t) => t.trackId));
    for (const id of [...camLinks.keys()]) if (!present.has(id)) camLinks.delete(id);

    const result = new Map<number, number>();
    const claimed = new Set<number>(); // gids already used by a track on THIS camera

    // 1. Tracks that already have an identity keep it
    for (const t of tracks) {
      const gid = camLinks.get(t.trackId);
      if (gid === undefined || !this.people.has(gid) || claimed.has(gid)) {
        if (gid !== undefined) camLinks.delete(t.trackId);
        continue;
      }
      claimed.add(gid);
      result.set(t.trackId, gid);
      this.touch(this.people.get(gid)!, camId, t, now);
    }

    // 2. New tracks: match against everyone not already on this camera, best matches first
    const fresh = tracks.filter((t) => !result.has(t.trackId) && t.embedding);
    const pairs: Array<{ t: TrackObservation; gid: number; score: number; runnerUp: number }> = [];
    for (const t of fresh) {
      const scored: Array<{ gid: number; score: number }> = [];
      for (const p of this.people.values()) {
        if (claimed.has(p.gid)) continue;
        scored.push({ gid: p.gid, score: this.similarity(p, t.embedding!) });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored.length && scored[0].score >= MATCH_THRESHOLD) {
        pairs.push({ t, gid: scored[0].gid, score: scored[0].score, runnerUp: scored[1]?.score ?? -1 });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const matchedTracks = new Set<number>();
    for (const pair of pairs) {
      if (claimed.has(pair.gid) || matchedTracks.has(pair.t.trackId)) continue;
      const ambiguous = pair.runnerUp >= MATCH_THRESHOLD && pair.score - pair.runnerUp < MATCH_MARGIN;
      if (ambiguous) continue; // better a separate ID than a wrong merge
      claimed.add(pair.gid);
      matchedTracks.add(pair.t.trackId);
      camLinks.set(pair.t.trackId, pair.gid);
      result.set(pair.t.trackId, pair.gid);
      this.touch(this.people.get(pair.gid)!, camId, pair.t, now);
    }

    // 3. Whoever is still unmatched (and has an embedding) is a new person
    for (const t of fresh) {
      if (result.has(t.trackId) || t.canCreate === false) continue;
      const p = this.create(t.embedding!, now);
      claimed.add(p.gid);
      camLinks.set(t.trackId, p.gid);
      result.set(t.trackId, p.gid);
      this.touch(p, camId, t, now);
    }

    this.prune(now);
    return result;
  }

  /** Highest similarity between an embedding and anything in the person's gallery. */
  private similarity(p: GlobalPerson, e: Float32Array): number {
    let best = -1;
    for (const g of p.gallery) best = Math.max(best, cosine(g, e));
    return best;
  }

  private create(e: Float32Array, now: number): GlobalPerson {
    const gid = this.nextGid++;
    const p: GlobalPerson = {
      gid,
      label: `P${gid}`,
      color: PERSON_COLORS[(gid - 1) % PERSON_COLORS.length],
      gallery: [e],
      firstSeen: now,
      lastSeen: now,
      sightings: new Map(),
      violations: new Map(),
    };
    this.people.set(gid, p);
    return p;
  }

  private touch(p: GlobalPerson, camId: string, t: TrackObservation, now: number): void {
    p.lastSeen = now;
    p.sightings.set(camId, { camId, trackId: t.trackId, box: t.box, posture: t.posture, ts: now });
    if (t.embedding) this.addToGallery(p, t.embedding);
  }

  private addToGallery(p: GlobalPerson, e: Float32Array): void {
    let nearest = -1;
    let nearestSim = -1;
    p.gallery.forEach((g, i) => {
      const s = cosine(g, e);
      if (s > nearestSim) {
        nearestSim = s;
        nearest = i;
      }
    });
    if (nearest >= 0 && nearestSim >= GALLERY_DUPLICATE_SIM) return; // already represented
    if (p.gallery.length < GALLERY_SIZE) p.gallery.push(e);
    else p.gallery[(p.gallery.length - 1 - (p.gallery.length % 3)) % p.gallery.length] = e; // rotate the later slots, keep the first views
  }

  /**
   * Replace a person's ACTIVE violations on one camera with the latest verdict. Violations that were active on that
   * camera and are no longer reported are marked resolved (kept briefly as history).
   */
  setViolations(
    gid: number,
    camId: string,
    current: Array<{ ruleId: string; ruleName: string; severity: string; explanation: string }>,
    now: number
  ): void {
    const p = this.people.get(gid);
    if (!p) return;
    const seen = new Set<string>();
    for (const v of current) {
      const key = `${camId}|${v.ruleId}`;
      seen.add(key);
      const existing = p.violations.get(key);
      if (existing && existing.active) {
        existing.lastSeen = now;
        existing.explanation = v.explanation;
      } else {
        p.violations.set(key, { ...v, camId, since: now, lastSeen: now, active: true });
      }
    }
    for (const [key, rec] of p.violations) {
      if (rec.camId === camId && rec.active && !seen.has(key)) {
        rec.active = false;
        rec.resolvedAt = now;
      }
    }
    // Keep only the 12 most recent resolved records
    const resolved = [...p.violations.entries()].filter(([, r]) => !r.active).sort((a, b) => (b[1].resolvedAt ?? 0) - (a[1].resolvedAt ?? 0));
    resolved.slice(12).forEach(([k]) => p.violations.delete(k));
  }

  getPerson(gid: number): GlobalPerson | undefined {
    return this.people.get(gid);
  }

  /** Everyone, most recently seen first. `active` = seen within the activity window. */
  list(now: number): Array<GlobalPerson & { active: boolean; activeViolations: ViolationRecord[] }> {
    return [...this.people.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((p) => ({
        ...p,
        active: now - p.lastSeen <= ACTIVE_WINDOW_MS,
        activeViolations: [...p.violations.values()].filter((v) => v.active),
      }));
  }

  /**
   * Plain-language context for one person, shared with SAM-segmented crops and the Muse Spark prompt:
   * where else they are right now and what has already been flagged.
   */
  describe(gid: number, forCamId: string, camNames: Record<string, string>, now: number): string {
    const p = this.people.get(gid);
    if (!p) return '';
    const name = (id: string) => camNames[id] || id;
    const parts: string[] = [`${p.label}: first seen ${Math.round((now - p.firstSeen) / 1000)}s ago`];

    const elsewhere = [...p.sightings.values()]
      .filter((s) => s.camId !== forCamId)
      .map((s) => `${name(s.camId)} (${Math.round((now - s.ts) / 1000)}s ago${s.posture ? `, ${s.posture}` : ''})`);
    if (elsewhere.length) parts.push(`also seen on ${elsewhere.join('; ')}`);

    const active = [...p.violations.values()].filter((v) => v.active);
    if (active.length) {
      parts.push(
        'ACTIVE violations: ' +
          active.map((v) => `"${v.ruleName}" on ${name(v.camId)} for ${Math.round((now - v.since) / 1000)}s`).join('; ')
      );
    }
    const resolved = [...p.violations.values()].filter((v) => !v.active).slice(-3);
    if (resolved.length) parts.push('recently resolved: ' + resolved.map((v) => `"${v.ruleName}" (${name(v.camId)})`).join('; '));
    return parts.join('. ') + '.';
  }

  private prune(now: number): void {
    for (const [gid, p] of this.people) {
      if (now - p.lastSeen > FORGET_AFTER_MS) this.people.delete(gid);
      // A "person" that was only ever seen for a moment is almost certainly a false detection
      else if (now - p.lastSeen > GHOST_AFTER_MS && p.lastSeen - p.firstSeen < GHOST_MAX_SEEN_MS && p.violations.size === 0) this.people.delete(gid);
    }
    if (this.people.size > MAX_PEOPLE) {
      [...this.people.values()]
        .sort((a, b) => a.lastSeen - b.lastSeen)
        .slice(0, this.people.size - MAX_PEOPLE)
        .forEach((p) => this.people.delete(p.gid));
    }
  }

  reset(): void {
    this.people.clear();
    this.links.clear();
    this.nextGid = 1;
  }

  /** Drop one camera's links (camera paused / source changed) without forgetting the people. */
  clearCamera(camId: string): void {
    this.links.delete(camId);
    for (const p of this.people.values()) {
      p.sightings.delete(camId);
      for (const [k, v] of p.violations) if (v.camId === camId && v.active) p.violations.set(k, { ...v, active: false, resolvedAt: Date.now() });
    }
  }
}
