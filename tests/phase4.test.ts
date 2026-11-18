import { describe, expect, it } from 'vitest';
import { RideEngine } from '../src/engine/rideEngine';
import { FogGrid } from '../src/world/exploration';
import { Heightfield } from '../src/world/heightfield';
import { JunctionSelector, labelExit, turnKind } from '../src/world/junction';
import { MVP_POIS, resolvePois } from '../src/world/pois';
import { GameProgress } from '../src/world/progress';
import { RiderOnNetwork } from '../src/world/rider';
import type { RoadLayout } from '../src/world/roadLayout';
import { buildRoadNetwork } from '../src/world/roadNetwork';
import { sanitizeSave, type SaveData } from '../src/world/saveGame';
import { createWorld } from '../src/world/world';

const world = createWorld();

// Kreuzung K: von W kommend geht es nach N (links), O (geradeaus), S (rechts)
const layout: RoadLayout = {
  nodes: [
    { id: 'W', x: -200, z: 0 }, { id: 'K', x: 0, z: 0 },
    { id: 'O', x: 200, z: 0, name: 'Osthof' }, { id: 'N', x: 0, z: -200, name: 'Nordhof' },
    { id: 'S', x: 0, z: 200 },
  ],
  edges: [
    { id: 'wk', from: 'W', to: 'K' }, { id: 'ko', from: 'K', to: 'O' },
    { id: 'kn', from: 'K', to: 'N' }, { id: 'ks', from: 'K', to: 'S', name: 'Südweg' },
  ],
};
const net = buildRoadNetwork(layout, new Heightfield(1000, 51, new Float32Array(51 * 51).fill(10)));

describe('Richtungswahl', () => {
  it('ordnet Winkel richtig ein', () => {
    expect(turnKind(0)).toBe('geradeaus');
    expect(turnKind(-Math.PI / 2)).toBe('links');
    expect(turnKind(0.6)).toBe('halbrechts');
    expect(turnKind(Math.PI)).toBe('zurück');
  });

  it('beschriftet Abzweigungen mit Ziel und Wegname', () => {
    const r = new RiderOnNetwork(net, 'wk', 100, 1);
    const labels = r.upcomingExits().map((e) => labelExit(net, e));
    expect(labels.find((l) => l.kind === 'links')?.destination).toBe('Nordhof');
    expect(labels.find((l) => l.kind === 'geradeaus')?.destination).toBe('Osthof');
    expect(labels.find((l) => l.kind === 'rechts')?.destination).toBe('Südweg');
  });

  it('unbenannte Ziele zeigen auf den nächsten benannten Ort', () => {
    // Am Ostkai: Küstenweg führt zum unbenannten Knoten „ostweg“, dahinter Stadttor/Aussicht
    const r = new RiderOnNetwork(world.roads, 'prom-e', 500, 1);
    const labels = r.upcomingExits().map((e) => labelExit(world.roads, e));
    expect(labels.every((l) => l.destination !== 'Weg')).toBe(true);
    expect(labels.map((l) => l.destination)).toContain('Hafenbrücke');
  });

  it('ohne Wahl geradeaus, mit Wahl links/rechts', () => {
    const sel = new JunctionSelector();
    const r = new RiderOnNetwork(net, 'wk', 150, 1);
    r.chooser = sel.chooser;
    const node = r.nextNode;
    sel.step(node, r.upcomingExits(), -1);
    r.advance(60);
    expect(r.edge.id).toBe('kn');

    const r2 = new RiderOnNetwork(net, 'wk', 150, 1);
    r2.chooser = sel.chooser;
    sel.step(r2.nextNode, r2.upcomingExits(), 1);
    r2.advance(60);
    expect(r2.edge.id).toBe('ks');

    const r3 = new RiderOnNetwork(net, 'wk', 150, 1);
    r3.chooser = sel.chooser;
    r3.advance(60);
    expect(r3.edge.id).toBe('ko');
  });

  it('bleibt am Rand stehen und lässt sich zurückschalten', () => {
    const sel = new JunctionSelector();
    const r = new RiderOnNetwork(net, 'wk', 150, 1);
    const node = r.nextNode;
    const exits = r.upcomingExits();
    sel.step(node, exits, -1);
    expect(sel.step(node, exits, -1)?.edge.id).toBe('kn');
    expect(sel.step(node, exits, 1)?.edge.id).toBe('ko');
  });

  it('die Wahl gilt nur für ihre Kreuzung und wird danach zurückgesetzt', () => {
    const sel = new JunctionSelector();
    const r = new RiderOnNetwork(net, 'wk', 150, 1);
    sel.step(r.nextNode, r.upcomingExits(), -1);
    expect(sel.selectionFor('O')).toBeNull();
    r.chooser = sel.chooser;
    r.advance(60);
    expect(sel.selectionFor('K')).toBeNull();
  });

  it('Kehrtwende dreht die Fahrtrichtung', () => {
    const r = new RiderOnNetwork(net, 'wk', 100, 1);
    r.reverse();
    r.advance(10);
    expect(r.position.x).toBeCloseTo(-110, 0);
  });
});

describe('POIs', () => {
  const pois = resolvePois(world.roads);

  it('alle Definitionen verweisen auf existierende Wege und Knoten', () => {
    expect(pois).toHaveLength(MVP_POIS.length);
    for (const p of pois) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });

  it('IDs sind eindeutig, 30 Sammelobjekte (15 + je 5 in Glutsteppe, am Kogel und an den Spiegelseen)', () => {
    expect(new Set(pois.map((p) => p.id)).size).toBe(pois.length);
    expect(pois.filter((p) => p.type === 'collectible')).toHaveLength(35);
  });

  it('jedes Sammelobjekt ist mit dem Fahrer erreichbar', () => {
    // Fährt man die Kante ab, kommt man nah genug vorbei
    for (const p of pois.filter((q) => q.type === 'collectible')) {
      const e = world.roads.edge(p.edgeId!);
      const r = new RiderOnNetwork(world.roads, e.id, 0, 1);
      let best = Infinity;
      for (let s = 0; s < e.length; s += 1) {
        const q = r.edge.pointAt(s);
        best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
      }
      expect(best).toBeLessThan(p.radius);
    }
  });
});

describe('GameProgress', () => {
  const pois = resolvePois(world.roads);
  const k01 = pois.find((p) => p.id === 'k01')!;
  const sign = pois.find((p) => p.type === 'sign')!;

  it('sammelt einmal ein', () => {
    const g = new GameProgress(pois);
    const ev = g.update(k01, 0);
    expect(ev).toEqual([expect.objectContaining({ type: 'collect', collected: 1, total: 35 })]);
    expect(g.update(k01, 1)).toEqual([]);
  });

  it('weit weg passiert nichts', () => {
    expect(new GameProgress(pois).update({ x: k01.x + 50, y: k01.y, z: k01.z }, 0)).toEqual([]);
  });

  it('Ortsschilder mit Wiederholsperre', () => {
    const g = new GameProgress(pois);
    expect(g.update(sign, 0).some((e) => e.type === 'sign')).toBe(true);
    expect(g.update(sign, 10).some((e) => e.type === 'sign')).toBe(false);
    g.update({ x: 99999, y: 0, z: 0 }, 50);
    expect(g.update(sign, 200).some((e) => e.type === 'sign')).toBe(true);
  });

  it('übernimmt gespeicherten Fortschritt und ignoriert unbekannte IDs', () => {
    const g = new GameProgress(pois, { collected: ['k01', 'gibtsnicht'], viewpoints: ['v-kapelle'] });
    expect(g.collectedCount).toBe(1);
    expect(g.viewpointCount).toBe(1);
  });
});

describe('FogGrid', () => {
  it('deckt einen Kreis auf', () => {
    const f = new FogGrid(1000, 20);
    expect(f.isRevealed(0, 0)).toBe(false);
    const n = f.reveal(0, 0, 100);
    expect(n).toBeGreaterThan(70);
    expect(f.isRevealed(0, 0)).toBe(true);
    expect(f.isRevealed(90, 0)).toBe(true);
    expect(f.isRevealed(200, 0)).toBe(false);
    expect(f.reveal(0, 0, 100)).toBe(0);
  });

  it('ist am Rand robust und lässt sich wiederherstellen', () => {
    const f = new FogGrid(1000, 20);
    f.reveal(499, 499, 60);
    const copy = new FogGrid(1000, 20, f.cells);
    expect(copy.isRevealed(495, 495)).toBe(true);
    expect(copy.fraction()).toBeCloseTo(f.fraction(), 10);
    expect(new FogGrid(1000, 20, new Uint8Array(3)).fraction()).toBe(0);
  });
});

describe('Spielstand', () => {
  const valid: SaveData = {
    version: 1, seed: world.seed, savedAt: 1,
    position: { edgeId: 'rebstrasse', s: 100, dir: -1 },
    totals: { distance: 1234, elevationGain: 56, timeSec: 300 },
    gearIndex: 4, collected: ['k01'], viewpoints: [], fog: new Uint8Array(10),
    achievements: [], bonusXp: 0, segments: {},
  };

  it('übernimmt einen gültigen Stand', () => {
    expect(sanitizeSave(valid, world)).toEqual(valid);
  });

  it('verwirft fremde Welten und Unsinn', () => {
    expect(sanitizeSave({ ...valid, seed: 1 }, world)).toBeNull();
    expect(sanitizeSave({ ...valid, version: 2 }, world)).toBeNull();
    expect(sanitizeSave(null, world)).toBeNull();
    expect(sanitizeSave('x', world)).toBeNull();
  });

  it('repariert kaputte Teile', () => {
    const s = sanitizeSave({ ...valid, position: { edgeId: 'weg', s: 1, dir: 1 }, totals: { distance: -5, elevationGain: NaN }, collected: [1, 'k02'] }, world)!;
    expect(s.position).toEqual(world.spawn);
    expect(s.totals).toEqual({ distance: 0, elevationGain: 0, timeSec: 0 });
    expect(s.collected).toEqual(['k02']);
  });

  it('klemmt die Position auf die Weglänge', () => {
    const s = sanitizeSave({ ...valid, position: { edgeId: 'rebstrasse', s: 1e9, dir: 1 } }, world)!;
    expect(s.position.s).toBeCloseTo(world.roads.edge('rebstrasse').length);
  });

  it('Engine übernimmt Gesamtwerte, Getriebe den Gang', () => {
    const e = new RideEngine();
    e.restoreTotals({ distance: 1000, elevationGain: 50, timeSec: 120 });
    e.gears.set(99);
    const st = e.state(0);
    expect(st.distance).toBe(1000);
    expect(st.elevationGain).toBe(50);
    expect(st.gearIndex).toBe(e.gears.ratios.length - 1);
  });
});

describe('Erkundungsnebel aus einer kleineren Welt', () => {
  it('wird mittig in die größere Welt übertragen', () => {
    const small = new FogGrid(3000, 20);
    small.reveal(500, 900, 60);
    small.reveal(-1400, -1400, 30);
    const big = new FogGrid(4800, 20, small.cells);
    expect(big.res).toBe(240);
    expect(big.isRevealed(500, 900)).toBe(true);
    expect(big.isRevealed(-1400, -1400)).toBe(true);
    expect(big.isRevealed(2000, 0)).toBe(false);
    expect(big.countRevealed(() => true)).toBe(small.countRevealed(() => true));
  });

  it('auch von 4,8 auf 6 km (Hoher Kogel)', () => {
    const old = new FogGrid(4800, 20);
    old.reveal(1800, 700, 50);
    const big = new FogGrid(6000, 20, old.cells);
    expect(big.res).toBe(300);
    expect(big.isRevealed(1800, 700)).toBe(true);
    expect(big.isRevealed(0, -2300)).toBe(false);
    expect(big.countRevealed(() => true)).toBe(old.countRevealed(() => true));
  });

  it('auch von 6 auf 7,2 km (Nordkap)', () => {
    const old = new FogGrid(6000, 20);
    old.reveal(-2000, -2500, 50);
    const big = new FogGrid(7200, 20, old.cells);
    expect(big.res).toBe(360);
    expect(big.isRevealed(-2000, -2500)).toBe(true);
    expect(big.isRevealed(380, -3350)).toBe(false);
    expect(big.countRevealed(() => true)).toBe(old.countRevealed(() => true));
  });

  it('ignoriert Daten, die zu keinem Raster passen', () => {
    const big = new FogGrid(4800, 20, new Uint8Array(1000).fill(1));
    expect(big.countRevealed(() => true)).toBe(0);
  });
});
