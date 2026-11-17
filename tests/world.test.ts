import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/world/heightfield';
import { RiderOnNetwork, type ExitChooser } from '../src/world/rider';
import type { RoadLayout } from '../src/world/roadLayout';
import { buildRoadNetwork, splinePath } from '../src/world/roadNetwork';
import { generateTerrain, KOGEL, kogelMask, kogelProfile } from '../src/world/terrainGen';
import { createWorld, DEFAULT_SEED } from '../src/world/world';
import { REGIONS } from '../src/world/roadLayout';
import { MVP_SEGMENTS, resolveSegments } from '../src/world/segments';
import { findHairpins } from '../src/game/mountain';

const world = createWorld();

describe('Heightfield', () => {
  const hf = new Heightfield(100, 3, new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 0]));
  it('tastet bilinear ab', () => {
    expect(hf.sample(0, 0)).toBe(10);
    expect(hf.sample(25, 0)).toBeCloseTo(5);
    expect(hf.sample(-50, -50)).toBe(0);
  });
  it('klemmt außerhalb auf den Rand', () => {
    expect(hf.sample(1000, 0)).toBe(0);
  });
});

describe('Geländegenerator', () => {
  it('ist deterministisch', () => {
    const a = generateTerrain({ seed: 7, res: 65 });
    const b = generateTerrain({ seed: 7, res: 65 });
    const c = generateTerrain({ seed: 8, res: 65 });
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
  });
  it('hat Meer im Süden und Land im Norden', () => {
    const t = generateTerrain({ seed: 1 });
    expect(t.sample(0, 1450)).toBeLessThan(0);
    expect(t.sample(0, -1300)).toBeGreaterThan(80);
  });
  it('die Stadtfläche ist flach und über dem Meer', () => {
    const t = generateTerrain({ seed: 1 });
    for (const [x, z] of [[400, 900], [400, 650], [150, 460], [900, 800]] as const) {
      expect(t.sample(x, z)).toBeGreaterThan(2);
      expect(t.slope(x, z)).toBeLessThan(0.05);
    }
  });
});

describe('splinePath', () => {
  it('läuft durch Start und Ende und tastet gleichmäßig ab', () => {
    const p = splinePath([[0, 0], [50, 30], [100, 0]], 2);
    expect(p[0]).toEqual([0, 0]);
    expect(p.at(-1)![0]).toBeCloseTo(100);
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeLessThan(2.5);
    }
  });
});

describe('Wegenetz (MVP, Standard-Seed)', () => {
  const { roads } = world;

  it('hat ungefähr die geplante Länge', () => {
    expect(roads.totalLength).toBeGreaterThan(17000);
    expect(roads.totalLength).toBeLessThan(45000);
  });

  it('überschreitet nirgends 10 % Steigung', () => {
    for (const e of roads.edges.values()) {
      for (let i = 1; i < e.count; i++) {
        const g = (e.ys[i]! - e.ys[i - 1]!) / (e.ss[i]! - e.ss[i - 1]!);
        expect(Math.abs(g), `${e.id} @ ${e.ss[i]!.toFixed(0)} m`).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });

  it('Wegenden liegen exakt auf Knotenhöhe (keine Sprünge an Kreuzungen)', () => {
    for (const e of roads.edges.values()) {
      expect(e.ys[0]).toBeCloseTo(roads.node(e.from).y, 6);
      expect(e.ys[e.count - 1]).toBeCloseTo(roads.node(e.to).y, 6);
      expect(e.xs[0]).toBeCloseTo(roads.node(e.from).x, 6);
      expect(e.zs[e.count - 1]).toBeCloseTo(roads.node(e.to).z, 6);
    }
  });

  it('alle Wege liegen über dem Meer', () => {
    for (const e of roads.edges.values()) {
      for (const y of e.ys) expect(y).toBeGreaterThanOrEqual(2);
    }
  });

  it('das Gelände ist unter den Wegen auf Weghöhe eingeschnitten', () => {
    for (const e of roads.edges.values()) {
      if (e.surface === 'bridge') continue;
      for (let i = 0; i < e.count; i += 10) {
        const diff = Math.abs(world.terrain.sample(e.xs[i]!, e.zs[i]!) - e.ys[i]!);
        expect(diff, `${e.id} @ ${e.ss[i]!.toFixed(0)} m`).toBeLessThan(1.5);
      }
    }
  });

  it('die Hafenbrücke überspannt Wasser und liegt deutlich darüber', () => {
    const b = roads.edge('hafenbruecke');
    const mid = b.pointAt(b.length / 2);
    expect(world.terrain.sample(mid.x, mid.z)).toBeLessThan(-3);
    expect(mid.y).toBeGreaterThan(8);
    for (let i = 0; i < b.count; i += 5) expect(Math.abs(b.gradeAt(b.ss[i]!))).toBeLessThan(0.06);
  });

  it('die Glutsteppe ist ein eigenes Gebiet hinter der Brücke', () => {
    const steppe = [...roads.edges.values()].filter((e) => e.region === 'glutsteppe');
    const len = steppe.reduce((s, e) => s + e.length, 0);
    expect(len).toBeGreaterThan(7000);
    // Nur die Brücke verbindet das Gebiet mit dem Rest
    for (const e of roads.edges.values()) {
      if (e.region) continue;
      expect([e.from, e.to].some((id) => roads.node(id).region === 'glutsteppe'), e.id).toBe(false);
    }
  });

  it('ist zusammenhängend', () => {
    const seen = new Set<string>();
    const stack = ['hafen'];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const eid of roads.node(id).edges) {
        const e = roads.edge(eid);
        stack.push(e.from === id ? e.to : e.from);
      }
    }
    expect(seen.size).toBe(roads.nodes.size);
  });

  it('meldet unbekannte Knoten im Layout', () => {
    const bad: RoadLayout = { nodes: [{ id: 'a', x: 0, z: 0 }], edges: [{ id: 'e', from: 'a', to: 'x' }] };
    expect(() => buildRoadNetwork(bad, generateTerrain({ seed: 1, res: 33 }))).toThrow(/unbekannt/);
  });
});

describe('RiderOnNetwork', () => {
  // Kleines Testnetz: Kreuzung K mit Wegen nach W, O (geradeaus) und N (links)
  //        N
  //        |
  //  W --- K --- O
  const layout: RoadLayout = {
    nodes: [
      { id: 'W', x: -200, z: 0 }, { id: 'K', x: 0, z: 0 }, { id: 'O', x: 200, z: 0 },
      { id: 'N', x: 0, z: -200 },
    ],
    edges: [
      { id: 'wk', from: 'W', to: 'K' }, { id: 'ko', from: 'K', to: 'O' }, { id: 'nk', from: 'N', to: 'K' },
    ],
  };
  const flat = () => new Heightfield(1000, 51, new Float32Array(51 * 51).fill(10));
  const net = buildRoadNetwork(layout, flat());

  it('fährt an Kreuzungen standardmäßig geradeaus', () => {
    const r = new RiderOnNetwork(net, 'wk', 190, 1);
    r.advance(20);
    expect(r.edge.id).toBe('ko');
    expect(r.dir).toBe(1);
    expect(r.s).toBeCloseTo(10, 0);
    expect(r.lastNode?.id).toBe('K');
  });

  it('befährt Kanten auch rückwärts', () => {
    // Von O nach Westen: ko rückwärts, dann geradeaus auf wk rückwärts
    const r = new RiderOnNetwork(net, 'ko', 10, -1);
    r.advance(30);
    expect(r.edge.id).toBe('wk');
    expect(r.dir).toBe(-1);
    expect(r.position.x).toBeCloseTo(-20, 0);
  });

  it('meldet die Abzweigungen mit Richtung (links negativ)', () => {
    const r = new RiderOnNetwork(net, 'wk', 100, 1);
    const exits = r.upcomingExits();
    expect(exits).toHaveLength(2);
    const north = exits.find((e) => e.edge.id === 'nk')!;
    expect(north.dir).toBe(-1);
    expect(north.turn).toBeCloseTo(-Math.PI / 2, 1); // nach Norden = links, wenn man nach Osten fährt
  });

  it('eine eigene Auswahl wird verwendet', () => {
    const r = new RiderOnNetwork(net, 'wk', 195, 1);
    const left: ExitChooser = (_n, exits) => exits.reduce((a, b) => (b.turn < a.turn ? b : a));
    r.chooser = left;
    r.advance(15);
    expect(r.edge.id).toBe('nk');
    expect(r.position.z).toBeLessThan(0);
  });

  it('kehrt am Wegende um', () => {
    const r = new RiderOnNetwork(net, 'ko', 195, 1);
    r.advance(10);
    expect(r.edge.id).toBe('ko');
    expect(r.dir).toBe(-1);
    expect(r.s).toBeCloseTo(195, 0);
  });

  it('springt nie bei der Position, auch über mehrere Knoten', () => {
    const r = new RiderOnNetwork(world.roads, world.spawn.edgeId, world.spawn.s, world.spawn.dir);
    let prev = r.position;
    for (let i = 0; i < 20000; i++) {
      r.advance(0.5);
      const p = r.position;
      const jump = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      expect(jump).toBeLessThan(1.0);
      prev = p;
    }
  });

  it('Steigung hat das richtige Vorzeichen je Fahrtrichtung', () => {
    const net2 = buildRoadNetwork(
      { nodes: [{ id: 'a', x: -100, z: 0 }, { id: 'b', x: 100, z: 0 }], edges: [{ id: 'ab', from: 'a', to: 'b' }] },
      (() => {
        // Rampe: 5 % nach Osten
        const hf = new Heightfield(1000, 101);
        for (let j = 0; j < 101; j++) for (let i = 0; i < 101; i++) hf.set(i, j, 50 + hf.worldX(i) * 0.05);
        return hf;
      })(),
    );
    expect(new RiderOnNetwork(net2, 'ab', 100, 1).grade).toBeCloseTo(0.05, 2);
    expect(new RiderOnNetwork(net2, 'ab', 100, -1).grade).toBeCloseTo(-0.05, 2);
  });
});

describe('Gesperrte Gebiete', () => {
  const world = createWorld();
  const roads = world.roads;

  it('an der Schranke kehrt der Fahrer um, solange das Gebiet gesperrt ist', () => {
    roads.lockedRegions.add('glutsteppe');
    const r = new RiderOnNetwork(roads, 'brueckenweg', 0, 1);
    expect(r.upcomingExits().map((e) => e.edge.id)).toEqual(['brueckenweg']);
    r.advance(roads.edge('brueckenweg').length + 5);
    expect(r.edge.id).toBe('brueckenweg');
    expect(r.dir).toBe(-1);
    roads.lockedRegions.delete('glutsteppe');
  });

  it('nach der Freischaltung geht es über die Hafenbrücke', () => {
    const r = new RiderOnNetwork(roads, 'brueckenweg', 0, 1);
    r.advance(roads.edge('brueckenweg').length + 5);
    expect(r.edge.id).toBe('hafenbruecke');
  });
});

describe('Hoher Kogel', () => {
  const world = createWorld();
  const roads = world.roads;
  const raw = generateTerrain({ seed: DEFAULT_SEED });

  it('der Gipfel ist rund 700 m hoch, im Norden liegt Meer', () => {
    expect(raw.sample(KOGEL.x, KOGEL.z)).toBeGreaterThan(660);
    expect(raw.sample(KOGEL.x, KOGEL.z)).toBeLessThan(730);
    expect(raw.sample(0, -2990)).toBeLessThan(0);
  });

  it('läuft vor dem Passweg aus: Rebland und Passstraße bleiben unverändert', () => {
    for (const id of ['pass', 'waldrand', 'hangdorf', 'kapelle', 'weinN']) {
      const n = roads.node(id);
      expect(kogelMask(n.x, n.z)).toBeLessThan(0.001); // < 0,5 m
    }
    expect(kogelProfile(0)).toBe(1);
    expect(kogelProfile(1)).toBe(0);
  });

  it('ist ein eigenes Gebiet ab Level 6 mit zwei Zugängen', () => {
    const r = REGIONS.find((x) => x.id === 'kogel')!;
    expect(r.unlockLevel).toBe(6);
    for (const g of r.gateNodes) {
      expect(roads.node(g).gate).toBe(true);
      expect(roads.node(g).edges.some((id) => roads.edge(id).region === 'kogel')).toBe(true);
    }
    for (const id of ['kogelstrasse', 'gipfelstrasse', 'westrampe']) expect(roads.edge(id).region).toBe('kogel');
  });

  it('beide Auffahrten sind lang und im Mittel mäßig steil', () => {
    const top = roads.node('gipfel');
    expect(top.y).toBeGreaterThan(650);
    const [kogel, west] = resolveSegments(roads, MVP_SEGMENTS.filter((s) => s.id.startsWith('climb-') && s.id !== 'climb-kapelle'));
    for (const seg of [kogel!, west!]) {
      expect(seg.length).toBeGreaterThan(6500);
      expect(seg.length).toBeLessThan(9000);
      expect(seg.climb).toBeGreaterThan(450);
      const avg = (top.y - seg.legs[0]!.edge.heightAt(seg.legs[0]!.dir === 1 ? 0 : seg.legs[0]!.edge.length)) / seg.length;
      expect(avg).toBeGreaterThan(0.055);
      expect(avg).toBeLessThan(0.085);
    }
  });

  it('die Serpentinen haben Kehren', () => {
    const up = [...findHairpins(roads.edge('kogelstrasse')), ...findHairpins(roads.edge('gipfelstrasse'))];
    expect(up.length).toBeGreaterThanOrEqual(8);
    expect(findHairpins(roads.edge('westrampe')).length).toBeGreaterThanOrEqual(8);
    // Eine Gerade hat keine
    expect(findHairpins(roads.edge('lange-gerade'))).toHaveLength(0);
  });

  it('in den Kehren sticht das Gelände nicht durch die Fahrbahn', () => {
    for (const id of ['kogelstrasse', 'gipfelstrasse', 'westrampe']) {
      const e = roads.edge(id);
      for (let s = 0; s < e.length; s += 3) {
        const p = e.pointAt(s);
        expect(world.terrain.meshHeight(p.x, p.z)).toBeLessThan(p.y + 0.12);
      }
    }
  });

  it('gesperrt kehrt man am Waldrand nicht in die Westrampe ab', () => {
    roads.lockedRegions.add('kogel');
    const r = new RiderOnNetwork(roads, 'waldweg', 0, 1);
    expect(r.upcomingExits().some((x) => x.edge.id === 'westrampe')).toBe(false);
    roads.lockedRegions.delete('kogel');
    expect(r.upcomingExits().some((x) => x.edge.id === 'westrampe')).toBe(true);
  });
});
