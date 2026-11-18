import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/world/heightfield';
import {
  ACHIEVEMENTS, levelFor, newAchievements, totalXp, xpForNextLevel, type PlayerStats,
} from '../src/world/progression';
import { RiderOnNetwork } from '../src/world/rider';
import type { RoadLayout } from '../src/world/roadLayout';
import { buildRoadNetwork } from '../src/world/roadNetwork';
import { sanitizeSave } from '../src/world/saveGame';
import {
  formatSegmentTime, GHOST_DT, ghostDistanceAt, ghostTimeAt, MVP_SEGMENTS, pointOnSegment,
  resolveSegments, SegmentTracker, type SegmentEvent, type SegmentRecord,
} from '../src/world/segments';
import { createWorld } from '../src/world/world';

const world = createWorld();

// Gerade A – B – C, bei B zweigt D nach Norden ab
const layout: RoadLayout = {
  nodes: [
    { id: 'A', x: -300, z: 0 }, { id: 'B', x: 0, z: 0 }, { id: 'C', x: 300, z: 0 },
    { id: 'D', x: 0, z: -300 }, { id: 'Z', x: -600, z: 0 },
  ],
  edges: [
    { id: 'za', from: 'Z', to: 'A' }, { id: 'ab', from: 'A', to: 'B' },
    { id: 'cb', from: 'C', to: 'B' }, { id: 'bd', from: 'B', to: 'D' },
  ],
};
const net = buildRoadNetwork(layout, new Heightfield(2000, 101, new Float32Array(101 * 101).fill(10)));
const [seg] = resolveSegments(net, [{ id: 'abc', name: 'Test', kind: 'sprint', nodes: ['A', 'B', 'C'] }]);

/** Fährt mit konstantem Tempo und meldet Knoten mit genauer Zeit an den Tracker. */
function ride(
  tracker: SegmentTracker, rider: RiderOnNetwork, meters: number, speed = 10,
  clock = { time: 0, dist: 0 }, dt = 0.1,
) {
  const events: SegmentEvent[] = [];
  rider.onNode = (node, exit, travelled) => {
    events.push(...tracker.onNode(node.id, { edgeId: exit.edge.id, dir: exit.dir }, clock.time + travelled / speed, clock.dist + travelled));
  };
  rider.onReverse = () => events.push(...tracker.onReverse());
  const step = speed * dt;
  for (let d = 0; d < meters; d += step) {
    rider.advance(step);
    clock.time += dt;
    clock.dist += step;
    tracker.update(clock.time, clock.dist);
  }
  return { events };
}

describe('Segmente', () => {
  it('alle MVP-Segmente lassen sich im Wegenetz auflösen', () => {
    const segs = resolveSegments(world.roads, MVP_SEGMENTS);
    expect(segs).toHaveLength(8);
    const climb = segs.find((s) => s.kind === 'climb')!;
    expect(climb.climb).toBeGreaterThan(50);
    expect(segs.every((s) => s.length > 300)).toBe(true);
    const tt = segs.find((s) => s.kind === 'tt')!;
    expect(tt.nodes[0]).toBe(tt.nodes[tt.nodes.length - 1]);
  });

  it('meldet fehlende Verbindungen', () => {
    expect(() => resolveSegments(net, [{ id: 'x', name: 'x', kind: 'tt', nodes: ['A', 'C'] }])).toThrow();
  });

  it('Strecke und Richtung der Abschnitte stimmen', () => {
    expect(seg!.legs.map((l) => [l.edge.id, l.dir])).toEqual([['ab', 1], ['cb', -1]]);
    expect(seg!.length).toBeCloseTo(600, -1);
    const mid = pointOnSegment(seg!, 450);
    expect(mid.x).toBeCloseTo(150, -1);
    expect(mid.dx).toBeCloseTo(1, 1);
  });

  it('misst die Zeit von Start bis Ziel', () => {
    const tracker = new SegmentTracker([seg!]);
    const rider = new RiderOnNetwork(net, 'za', 200, 1);
    const { events } = ride(tracker, rider, 750);
    expect(events.map((e) => e.type)).toEqual(['segmentStart', 'segmentFinish']);
    const fin = events[1]!;
    if (fin.type !== 'segmentFinish') throw new Error();
    expect(fin.time).toBeCloseTo(seg!.length / 10, 1);
    expect(fin.newBest).toBe(true);
    expect(fin.previousBest).toBeNull();
    const rec = tracker.record('abc');
    expect(rec.runs).toBe(1);
    expect(rec.best).toBeCloseTo(fin.time, 5);
    expect(rec.ghost!.length).toBeGreaterThan(fin.time / GHOST_DT - 1);
    expect(rec.ghost![rec.ghost!.length - 1]).toBeCloseTo(seg!.length, 0);
  });

  it('Abbiegen oder Kehrtwende bricht ab', () => {
    const tracker = new SegmentTracker([seg!]);
    const rider = new RiderOnNetwork(net, 'za', 200, 1);
    rider.chooser = (_n, exits) => exits.find((e) => e.edge.id === 'bd') ?? exits[0]!;
    expect(ride(tracker, rider, 500).events.map((e) => e.type)).toEqual(['segmentStart', 'segmentAbort']);

    const t2 = new SegmentTracker([seg!]);
    const r2 = new RiderOnNetwork(net, 'za', 250, 1);
    ride(t2, r2, 100);
    expect(t2.runs()).toHaveLength(1);
    r2.reverse();
    expect(t2.runs()).toHaveLength(0);
    expect(t2.record('abc').runs).toBe(0);
  });

  it('falsche Richtung startet kein Segment', () => {
    const tracker = new SegmentTracker([seg!]);
    const rider = new RiderOnNetwork(net, 'cb', 100, 1);
    expect(ride(tracker, rider, 400).events).toEqual([]);
  });

  it('Bestzeit nur bei schnellerer Fahrt, Ghost und Abstand', () => {
    const tracker = new SegmentTracker([seg!]);
    ride(tracker, new RiderOnNetwork(net, 'za', 250, 1), 700, 10);
    const best = tracker.record('abc').best!;

    // langsamer: keine neue Bestzeit, Abstand wächst
    const r2 = new RiderOnNetwork(net, 'za', 250, 1);
    const clock = { time: 0, dist: 0 };
    const slow = ride(tracker, r2, 350, 8, clock);
    const run = tracker.runs()[0]!;
    expect(run.delta!).toBeGreaterThan(5);
    expect(run.ghostDistance!).toBeGreaterThan(run.covered);
    const end = ride(tracker, r2, 400, 8, clock).events.find((e) => e.type === 'segmentFinish');
    expect(end && end.type === 'segmentFinish' && end.newBest).toBe(false);
    expect(tracker.record('abc').best).toBe(best);
    expect(slow.events[0]!.type).toBe('segmentStart');

    // schneller: neue Bestzeit, zählt als Verbesserung
    const fast = ride(tracker, new RiderOnNetwork(net, 'za', 250, 1), 700, 12);
    const fin = fast.events.find((e) => e.type === 'segmentFinish');
    expect(fin && fin.type === 'segmentFinish' && fin.newBest).toBe(true);
    const rec = tracker.record('abc');
    expect(rec.best!).toBeLessThan(best);
    expect(rec.runs).toBe(3);
    expect(rec.improvements).toBe(1);
  });

  it('Rundkurs: Ziel und neuer Start am selben Knoten', () => {
    const loop: RoadLayout = {
      nodes: [{ id: 'P', x: 0, z: 0 }, { id: 'Q', x: 300, z: 0 }, { id: 'R', x: 150, z: 260 }],
      edges: [{ id: 'pq', from: 'P', to: 'Q' }, { id: 'qr', from: 'Q', to: 'R' }, { id: 'rp', from: 'R', to: 'P' }],
    };
    const n = buildRoadNetwork(loop, new Heightfield(2000, 101, new Float32Array(101 * 101).fill(10)));
    const [ring] = resolveSegments(n, [{ id: 'ring', name: 'Ring', kind: 'tt', nodes: ['P', 'Q', 'R', 'P'] }]);
    const tracker = new SegmentTracker([ring!]);
    const rider = new RiderOnNetwork(n, 'rp', 200, 1);
    const { events } = ride(tracker, rider, ring!.length * 2 + 200);
    expect(events.map((e) => e.type)).toEqual(['segmentStart', 'segmentFinish', 'segmentFinish']);
    expect(tracker.record('ring').runs).toBe(2);
  });

  it('Ghost-Interpolation ist exakt am Ziel', () => {
    const ghost = Float32Array.from([0, 5, 10, 15, 18]); // Ziel 18 m bei 1,8 s
    expect(ghostDistanceAt(ghost, 0.25, 1.8)).toBeCloseTo(2.5);
    expect(ghostDistanceAt(ghost, 1.65, 1.8)).toBeCloseTo(16.5);
    expect(ghostDistanceAt(ghost, 9, 1.8)).toBe(18);
    expect(ghostTimeAt(ghost, 7.5, 1.8)).toBeCloseTo(0.75);
    expect(ghostTimeAt(ghost, 18, 1.8)).toBe(1.8);
    expect(ghostTimeAt(ghost, 16.5, 1.8)).toBeCloseTo(1.65);
  });

  it('formatiert Zeiten', () => {
    expect(formatSegmentTime(83.46)).toBe('1:23,5');
    expect(formatSegmentTime(9.96)).toBe('0:10,0');
  });
});

describe('Erfahrung und Erfolge', () => {
  const base: PlayerStats = {
    distance: 0, elevationGain: 0, timeSec: 0, collected: 0, collectibleTotal: 15,
    viewpoints: 0, viewpointTotal: 4, explored: 0, exploredKm2: 0, segments: new Map(),
  };

  it('Level-Kurve', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, needed: 200 });
    expect(levelFor(199).level).toBe(1);
    expect(levelFor(200)).toEqual({ level: 2, into: 0, needed: 250 });
    expect(levelFor(200 + 250 + 10)).toEqual({ level: 3, into: 10, needed: xpForNextLevel(3) });
  });

  it('XP aus Kilometern, Höhenmetern, Entdecktem und Erfolgen', () => {
    const s = { ...base, distance: 10_000, elevationGain: 100, collected: 2, viewpoints: 1, explored: 0.1, exploredKm2: 0.8 };
    expect(totalXp(s, new Set(), 0)).toBe(200 + 200 + 100 + 100 + 216);
    expect(totalXp(s, new Set(['km-1']), 30)).toBe(816 + 25 + 30);
  });

  it('Erfolge werden einmal freigeschaltet', () => {
    const s = { ...base, distance: 12_000, collected: 1 };
    const ids = newAchievements(s, new Set()).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['km-1', 'km-10', 'gem-1']));
    expect(ids).not.toContain('km-50');
    expect(newAchievements(s, new Set(ids))).toEqual([]);
  });

  it('Segment-Erfolge lesen die Bestzeiten', () => {
    const rec: SegmentRecord = { best: 200, runs: 5, improvements: 1, ghost: null };
    const s = { ...base, segments: new Map([['climb-kapelle', rec]]) };
    const ids = newAchievements(s, new Set()).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['seg-climb', 'climb-5', 'pb-1']));
    expect(ids).not.toContain('seg-sprint');
  });

  it('Erfolge haben eindeutige IDs', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('Spielstand Phase 5', () => {
  const v1 = {
    version: 1, seed: world.seed, savedAt: 1,
    position: { edgeId: 'rebstrasse', s: 100, dir: 1 },
    totals: { distance: 1, elevationGain: 1, timeSec: 1 },
    gearIndex: 1, collected: [], viewpoints: [], fog: new Uint8Array(0),
  };

  it('alte Stände ohne Phase-5-Felder bekommen Standardwerte', () => {
    const s = sanitizeSave(v1, world)!;
    expect(s.achievements).toEqual([]);
    expect(s.bonusXp).toBe(0);
    expect(s.segments).toEqual({});
  });

  it('übernimmt Bestzeiten und verwirft kaputte', () => {
    const ghost = Float32Array.from([0, 3, 6]);
    const s = sanitizeSave({
      ...v1,
      achievements: ['km-1', 3],
      bonusXp: -5,
      segments: {
        ok: { best: 1.2, runs: 2, improvements: 1, ghost },
        kaputt: { best: 'schnell', runs: 3, ghost: [1, 2] },
        weg: null,
      },
    }, world)!;
    expect(s.achievements).toEqual(['km-1']);
    expect(s.bonusXp).toBe(0);
    expect(s.segments.ok).toEqual({ best: 1.2, runs: 2, improvements: 1, ghost });
    expect(s.segments.kaputt).toEqual({ best: null, runs: 3, improvements: 0, ghost: null });
    expect(s.segments.weg).toBeUndefined();
  });
});
