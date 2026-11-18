import type { RoadEdge, RoadNetwork } from './roadNetwork';

/**
 * Segmente: feste Strecken im Wegenetz mit Zeitnahme und Bestzeit
 * (Sprintzone, Bergwertung, Zeitfahren). Ein Segment ist eine Knotenfolge,
 * die in genau dieser Richtung durchfahren werden muss.
 *
 * Die Zeitnahme beginnt beim Überfahren des Startknotens in Richtung des
 * ersten Abschnitts und endet am Zielknoten. Wer abbiegt oder umdreht,
 * bricht den Versuch ab.
 */

export type SegmentKind = 'sprint' | 'climb' | 'tt';

export interface SegmentDef {
  id: string;
  name: string;
  kind: SegmentKind;
  /** Knoten in Fahrtrichtung; aufeinanderfolgende Knoten müssen durch eine Kante verbunden sein. */
  nodes: string[];
}

export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  sprint: 'Sprintzone',
  climb: 'Bergwertung',
  tt: 'Zeitfahren',
};

export const MVP_SEGMENTS: SegmentDef[] = [
  { id: 'sprint-promenade', name: 'Promenade', kind: 'sprint', nodes: ['hafen', 'ostkai'] },
  { id: 'climb-kapelle', name: 'Kapellenanstieg', kind: 'climb', nodes: ['weinN', 'kapelle'] },
  { id: 'tt-weinberg', name: 'Weinbergrunde', kind: 'tt', nodes: ['rebdorf', 'weinW', 'weinN', 'rebdorf'] },
  { id: 'climb-kogel', name: 'Hoher Kogel', kind: 'climb', nodes: ['pass', 'kogelalm', 'gipfel'] },
  { id: 'climb-westrampe', name: 'Westrampe', kind: 'climb', nodes: ['waldrand', 'gipfel'] },
  { id: 'tt-seerunde', name: 'Seerunde', kind: 'tt', nodes: ['seesteg-s', 'ostbucht', 'seesteg-n', 'westbucht', 'seesteg-s'] },
  { id: 'tt-kaprunde', name: 'Kaprunde', kind: 'tt', nodes: ['kapdorf', 'robbenbucht', 'heidekreuz', 'kapdorf'] },
  { id: 'sprint-klippen', name: 'Klippenstraße', kind: 'sprint', nodes: ['moewenbucht', 'kapkreuz'] },
];

export interface SegmentLeg {
  edge: RoadEdge;
  dir: 1 | -1;
}

export interface Segment extends SegmentDef {
  legs: SegmentLeg[];
  length: number;
  /** Summe der Anstiege entlang der Strecke in m. */
  climb: number;
}

export function resolveSegments(net: RoadNetwork, defs: SegmentDef[] = MVP_SEGMENTS): Segment[] {
  return defs.map((d) => {
    if (d.nodes.length < 2) throw new Error(`Segment ${d.id} braucht mindestens zwei Knoten`);
    const legs: SegmentLeg[] = [];
    for (let i = 0; i + 1 < d.nodes.length; i++) {
      const a = d.nodes[i]!;
      const b = d.nodes[i + 1]!;
      const edge = [...net.edges.values()].find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
      if (!edge) throw new Error(`Segment ${d.id}: keine Kante zwischen ${a} und ${b}`);
      legs.push({ edge, dir: edge.from === a ? 1 : -1 });
    }
    let length = 0;
    let climb = 0;
    for (const { edge, dir } of legs) {
      length += edge.length;
      let prev = edge.heightAt(dir === 1 ? 0 : edge.length);
      for (let s = 10; s <= edge.length; s += 10) {
        const y = edge.heightAt(dir === 1 ? s : edge.length - s);
        if (y > prev) climb += y - prev;
        prev = y;
      }
    }
    return { ...d, legs, length, climb };
  });
}

/** Punkt und Fahrtrichtung nach `d` Metern ab Segmentstart. */
export function pointOnSegment(seg: Segment, d: number): { x: number; y: number; z: number; dx: number; dz: number } {
  let rest = Math.max(0, Math.min(seg.length, d));
  for (let i = 0; i < seg.legs.length; i++) {
    const { edge, dir } = seg.legs[i]!;
    if (rest <= edge.length || i === seg.legs.length - 1) {
      const s = dir === 1 ? Math.min(rest, edge.length) : edge.length - Math.min(rest, edge.length);
      const p = edge.pointAt(s);
      const t = edge.directionAt(s);
      return { ...p, dx: t.dx * dir, dz: t.dz * dir };
    }
    rest -= edge.length;
  }
  throw new Error('unreachable');
}

// --- Bestzeiten und Ghost --------------------------------------------------------

/** Abstand der Ghost-Stützpunkte in s. */
export const GHOST_DT = 0.5;

export interface SegmentRecord {
  /** Bestzeit in s, null = noch nie beendet. */
  best: number | null;
  /** Anzahl beendeter Fahrten. */
  runs: number;
  /** Wie oft die Bestzeit verbessert wurde (ohne die erste Fahrt). */
  improvements: number;
  /**
   * Bestfahrt: zurückgelegte Strecke ab Start alle GHOST_DT Sekunden,
   * der letzte Wert ist das Ziel (zur Zeit `best`).
   */
  ghost: Float32Array | null;
}

export const emptyRecord = (): SegmentRecord => ({ best: null, runs: 0, improvements: 0, ghost: null });

/**
 * Zeitpunkt des i-ten Stützpunkts. Die Stützpunkte liegen im Raster GHOST_DT,
 * nur der letzte (Ziel) liegt genau bei der Endzeit.
 */
function sampleTime(ghost: Float32Array, i: number, endTime: number): number {
  return i === ghost.length - 1 ? Math.max(endTime, (i - 1) * GHOST_DT) : i * GHOST_DT;
}

/** Strecke des Ghosts nach `elapsed` Sekunden (bleibt am Ziel stehen). */
export function ghostDistanceAt(ghost: Float32Array, elapsed: number, endTime: number): number {
  if (ghost.length === 0) return 0;
  const last = ghost.length - 1;
  if (elapsed >= endTime || last === 0) return ghost[last]!;
  const i = Math.min(last - 1, Math.floor(Math.max(0, elapsed) / GHOST_DT));
  const t0 = sampleTime(ghost, i, endTime);
  const t1 = sampleTime(ghost, i + 1, endTime);
  const f = t1 > t0 ? (elapsed - t0) / (t1 - t0) : 1;
  return ghost[i]! + (ghost[i + 1]! - ghost[i]!) * Math.min(1, Math.max(0, f));
}

/** Zeit, zu der der Ghost die Strecke `d` erreicht hat (Umkehrung von ghostDistanceAt). */
export function ghostTimeAt(ghost: Float32Array, d: number, endTime: number): number {
  if (ghost.length === 0) return 0;
  if (d <= ghost[0]!) return 0;
  const last = ghost.length - 1;
  if (d >= ghost[last]!) return endTime;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ghost[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = ghost[hi]! - ghost[lo]! || 1;
  const t0 = sampleTime(ghost, lo, endTime);
  const t1 = sampleTime(ghost, hi, endTime);
  return t0 + ((d - ghost[lo]!) / span) * (t1 - t0);
}

export type SegmentEvent =
  | { type: 'segmentStart'; segment: Segment; best: number | null }
  | {
      type: 'segmentFinish';
      segment: Segment;
      time: number;
      /** Bestzeit vor dieser Fahrt. */
      previousBest: number | null;
      newBest: boolean;
    }
  | { type: 'segmentAbort'; segment: Segment };

/** Laufender Versuch, für das HUD. */
export interface SegmentRun {
  segment: Segment;
  elapsed: number;
  covered: number;
  remaining: number;
  /** Abstand zur Bestzeit an dieser Stelle in s (positiv = langsamer), null ohne Bestzeit. */
  delta: number | null;
  /** Strecke des Ghosts ab Start, null ohne Bestzeit. */
  ghostDistance: number | null;
}

interface ActiveRun {
  segment: Segment;
  leg: number;
  startTime: number;
  startDistance: number;
  samples: number[];
  elapsed: number;
  covered: number;
}

export class SegmentTracker {
  readonly records = new Map<string, SegmentRecord>();
  private active: ActiveRun[] = [];

  constructor(
    readonly segments: Segment[],
    saved?: Record<string, SegmentRecord>,
  ) {
    for (const s of segments) this.records.set(s.id, saved?.[s.id] ?? emptyRecord());
  }

  record(id: string): SegmentRecord {
    return this.records.get(id) ?? emptyRecord();
  }

  /**
   * Fahrer passiert einen Knoten.
   * @param time Spielzeit beim Überfahren in s
   * @param distance Gesamtstrecke beim Überfahren in m
   */
  onNode(nodeId: string, exit: { edgeId: string; dir: 1 | -1 }, time: number, distance: number): SegmentEvent[] {
    const events: SegmentEvent[] = [];
    const finished = new Set<string>();
    this.active = this.active.filter((run) => {
      const { segment } = run;
      const legs = segment.legs;
      const isLast = run.leg === legs.length - 1;
      if (isLast && nodeId === segment.nodes[segment.nodes.length - 1]) {
        events.push(this.finish(run, time, distance));
        finished.add(segment.id);
        return false;
      }
      const next = legs[run.leg + 1];
      if (next && nodeId === segment.nodes[run.leg + 1] && next.edge.id === exit.edgeId && next.dir === exit.dir) {
        run.leg++;
        return true;
      }
      events.push({ type: 'segmentAbort', segment });
      return false;
    });

    for (const segment of this.segments) {
      if (this.active.some((r) => r.segment === segment)) continue;
      const first = segment.legs[0]!;
      if (nodeId !== segment.nodes[0] || first.edge.id !== exit.edgeId || first.dir !== exit.dir) continue;
      this.active.push({
        segment, leg: 0, startTime: time, startDistance: distance, samples: [0], elapsed: 0, covered: 0,
      });
      // Ziel und neuer Start am selben Knoten (Runde): nur ein Hinweis, kein eigener Start-Toast
      if (!finished.has(segment.id)) events.push({ type: 'segmentStart', segment, best: this.record(segment.id).best });
    }
    return events;
  }

  /** Kehrtwende bricht alle laufenden Versuche ab. */
  onReverse(): SegmentEvent[] {
    const events = this.active.map((r): SegmentEvent => ({ type: 'segmentAbort', segment: r.segment }));
    this.active = [];
    return events;
  }

  /** Jede Frame aufrufen: nimmt die Ghost-Stützpunkte auf. */
  update(time: number, distance: number): void {
    for (const run of this.active) {
      run.elapsed = Math.max(0, time - run.startTime);
      run.covered = Math.min(run.segment.length, Math.max(0, distance - run.startDistance));
      while (run.samples.length * GHOST_DT <= run.elapsed) run.samples.push(run.covered);
    }
  }

  /** Laufende Versuche mit Vergleich zur Bestzeit. */
  runs(): SegmentRun[] {
    return this.active.map((run) => {
      const rec = this.record(run.segment.id);
      const ghost = rec.best !== null ? rec.ghost : null;
      const end = rec.best ?? 0;
      return {
        segment: run.segment,
        elapsed: run.elapsed,
        covered: run.covered,
        remaining: Math.max(0, run.segment.length - run.covered),
        delta: ghost ? run.elapsed - ghostTimeAt(ghost, run.covered, end) : null,
        ghostDistance: ghost ? ghostDistanceAt(ghost, run.elapsed, end) : null,
      };
    });
  }

  private finish(run: ActiveRun, time: number, distance: number): SegmentEvent {
    const elapsed = Math.max(0, time - run.startTime);
    const rec = this.record(run.segment.id);
    const previousBest = rec.best;
    const newBest = previousBest === null || elapsed < previousBest;
    rec.runs++;
    if (newBest) {
      if (previousBest !== null) rec.improvements++;
      rec.best = elapsed;
      const samples = run.samples.filter((_, i) => i * GHOST_DT < elapsed);
      samples.push(Math.min(run.segment.length, distance - run.startDistance));
      rec.ghost = Float32Array.from(samples);
    }
    this.records.set(run.segment.id, rec);
    return { type: 'segmentFinish', segment: run.segment, time: elapsed, previousBest, newBest };
  }
}

/** Zeit als m:ss,z */
export function formatSegmentTime(sec: number): string {
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')},${tenths % 10}`;
}
