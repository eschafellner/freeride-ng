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
import { LAKES, lakeShape, nearestLake, waterLevelAt } from '../src/world/lakes';
import { shorePoint } from '../src/world/seenLayout';
import { COVES, coveBeach, nordkapMask, northCoastZ, NORTH_COAST_Z, seenMask, westCoastX } from '../src/world/terrainGen';

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
    expect(roads.totalLength).toBeLessThan(62000);
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

  it('der Gipfel ist rund 700 m hoch, im Norden liegt dahinter das Nordkap und Meer', () => {
    expect(raw.sample(KOGEL.x, KOGEL.z)).toBeGreaterThan(660);
    expect(raw.sample(KOGEL.x, KOGEL.z)).toBeLessThan(730);
    expect(raw.sample(0, -2990)).toBeGreaterThan(100);
    expect(raw.sample(0, -3500)).toBeLessThan(0);
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
    const r = new RiderOnNetwork(roads, 'waldweg-n', 0, 1);
    expect(r.upcomingExits().some((x) => x.edge.id === 'westrampe')).toBe(false);
    roads.lockedRegions.delete('kogel');
    expect(r.upcomingExits().some((x) => x.edge.id === 'westrampe')).toBe(true);
  });
});

describe('Spiegelseen', () => {
  const roads = world.roads;
  const seenEdges = [...roads.edges.values()].filter((e) => e.region === 'seen');

  it('ist ein eigenes Gebiet ab Level 4 mit Zugang am Forsthaus', () => {
    const r = REGIONS.find((x) => x.id === 'seen')!;
    expect(r.unlockLevel).toBe(4);
    expect(r.gateNodes).toEqual(['forsthaus']);
    const gate = roads.node('forsthaus');
    expect(gate.gate).toBe(true);
    expect(gate.region).toBeUndefined();
    // Der Waldweg läuft am Forsthaus durch, nur der Seeweg gehört zum Gebiet
    expect(gate.edges.map((id) => roads.edge(id).region)).toEqual(expect.arrayContaining([undefined, undefined, 'seen']));
  });

  it('gesperrt fährt man am Forsthaus geradeaus weiter zum Waldrand', () => {
    roads.lockedRegions.add('seen');
    const r = new RiderOnNetwork(roads, 'waldweg', 0, 1);
    expect(r.upcomingExits().map((x) => x.edge.id)).toEqual(['waldweg-n']);
    roads.lockedRegions.delete('seen');
    expect(r.upcomingExits().map((x) => x.edge.id).sort()).toEqual(['seeweg', 'waldweg-n']);
  });

  it('drei Seen liegen im Seengebiet, ihr Wasser auf eigener Höhe', () => {
    expect(LAKES).toHaveLength(3);
    for (const lake of LAKES) {
      const l = lake.lobes[0]!;
      expect(seenMask(l.x, l.z)).toBeGreaterThan(0.99);
      expect(lakeShape(lake, l.x, l.z)).toBeLessThan(0.1);
      expect(waterLevelAt(l.x, l.z)).toBe(lake.level);
      // Seegrund unter dem Spiegel, rundherum Land knapp darüber
      expect(world.terrain.sample(l.x, l.z)).toBeLessThan(lake.level - 3);
      for (let deg = 0; deg < 360; deg += 15) {
        const [x, z] = shorePoint(lake.id, 0, deg, 30);
        if (lakeShape(lake, x, z) < 1.05) continue; // Engstelle zwischen zwei Becken
        expect(world.terrain.sample(x, z)).toBeGreaterThan(lake.level);
      }
    }
    // Außerhalb der Seen ist der Wasserspiegel das Meer
    expect(waterLevelAt(0, 0)).toBe(0);
    expect(nearestLake(-1700, -1160).lake?.id).toBe('untersee');
  });

  it('die Westküste liegt im Norden weiter draußen, bei Rebland wie bisher', () => {
    expect(westCoastX(0)).toBeCloseTo(-1760, 0);
    expect(westCoastX(-2000)).toBeLessThan(-2700);
    expect(world.terrain.sample(-2900, -1700)).toBeLessThan(0);
  });

  it('die Wege sind flach und bleiben trocken', () => {
    let total = 0;
    let climb = 0;
    for (const e of seenEdges) {
      total += e.length;
      for (let s = 0; s + 10 < e.length; s += 10) {
        const dy = e.heightAt(s + 10) - e.heightAt(s);
        climb += Math.abs(dy);
      }
      if (e.surface === 'bridge') continue;
      for (let s = 0; s < e.length; s += 5) {
        const p = e.pointAt(s);
        expect(p.y - waterLevelAt(p.x, p.z), `${e.id} @ ${s}`).toBeGreaterThan(1);
        // Abstand zum Ufer, außer direkt an den Brückenköpfen
        const nearBridge = ['seesteg-s', 'seesteg-n'].some((id) => Math.hypot(roads.node(id).x - p.x, roads.node(id).z - p.z) < 45);
        if (!nearBridge) expect(nearestLake(p.x, p.z).e, `${e.id} @ ${s}`).toBeGreaterThan(1.05);
      }
    }
    expect(total).toBeGreaterThan(8000);
    // Im Mittel unter 3 % (auf und ab zusammen)
    expect(climb / total).toBeLessThan(0.03);
  });

  it('die Seebrücke überspannt den Spiegelsee mit Abstand zum Wasser', () => {
    const b = roads.edge('seebruecke');
    expect(b.surface).toBe('bridge');
    expect(b.length).toBeGreaterThan(200);
    const lake = LAKES.find((l) => l.id === 'spiegelsee')!;
    const mid = b.pointAt(b.length / 2);
    expect(lakeShape(lake, mid.x, mid.z)).toBeLessThan(1);
    expect(world.terrain.sample(mid.x, mid.z)).toBeLessThan(lake.level - 2);
    for (let s = 0; s <= b.length; s += 10) expect(b.heightAt(s)).toBeGreaterThan(lake.level + 3);
  });

  it('das Zeitfahren Seerunde ist ein Rundkurs mit der Seebrücke als Abkürzung daneben', () => {
    const [seg] = resolveSegments(roads, MVP_SEGMENTS.filter((s) => s.id === 'tt-seerunde'));
    expect(seg!.nodes[0]).toBe(seg!.nodes[seg!.nodes.length - 1]);
    expect(seg!.length).toBeGreaterThan(2500);
    expect(seg!.legs.some((l) => l.edge.id === 'seebruecke')).toBe(false);
  });
});

describe('Nordkap', () => {
  const roads = world.roads;
  const raw = generateTerrain({ seed: DEFAULT_SEED });
  const kapEdges = [...roads.edges.values()].filter((e) => e.region === 'nordkap');

  it('ist ein eigenes Gebiet ab Level 5 mit Zugängen am Oberseeblick und am Glutplateau', () => {
    const r = REGIONS.find((x) => x.id === 'nordkap')!;
    expect(r.unlockLevel).toBe(5);
    expect(r.gateNodes).toEqual(['oberseeblick', 'plateau']);
    for (const g of r.gateNodes) {
      const n = roads.node(g);
      expect(n.gate).toBe(true);
      expect(n.edges.some((id) => roads.edge(id).region === 'nordkap')).toBe(true);
    }
    // Die Torknoten gehören weiter zu ihren Gebieten
    expect(roads.node('oberseeblick').region).toBe('seen');
    expect(roads.node('plateau').region).toBe('glutsteppe');
  });

  it('gesperrt biegt man am Oberseeblick nicht in die Nordstraße ab', () => {
    roads.lockedRegions.add('nordkap');
    const r = new RiderOnNetwork(roads, 'obersee-n', 0, 1);
    expect(r.upcomingExits().map((x) => x.edge.id)).toEqual(['obersee-nw']);
    roads.lockedRegions.delete('nordkap');
    expect(r.upcomingExits().map((x) => x.edge.id).sort()).toEqual(['nordstrasse', 'obersee-nw']);
  });

  it('die Küste wölbt sich nach Norden, das Kap ragt am weitesten hinaus', () => {
    expect(northCoastZ(-2200)).toBeCloseTo(NORTH_COAST_Z, 0);
    expect(northCoastZ(0)).toBeLessThan(NORTH_COAST_Z - 380);
    const tip = roads.node('leuchtturm');
    expect(world.terrain.sample(tip.x, tip.z)).toBeGreaterThan(100);
    expect(world.terrain.sample(tip.x, tip.z - 120)).toBeLessThan(0);
    expect(northCoastZ(380)).toBeLessThan(Math.min(northCoastZ(0), northCoastZ(800)) - 100);
  });

  it('hohe Klippen, unten in den Buchten ein Strand', () => {
    for (const c of COVES) {
      const [x, z] = coveBeach(c);
      const h = world.terrain.sample(x, z);
      expect(h, c.id).toBeGreaterThan(0.3);
      expect(h, c.id).toBeLessThan(5);
      // Rundherum hohe Klippen
      expect(world.terrain.sample(x - 180, z), c.id).toBeGreaterThan(80);
      expect(world.terrain.sample(x + 180, z), c.id).toBeGreaterThan(80);
    }
  });

  it('außerhalb des Nordkaps bleibt das Gelände unverändert (Wege anderer Gebiete)', () => {
    for (const e of roads.edges.values()) {
      if (e.region === 'nordkap') continue;
      for (let s = 0; s <= e.length; s += 20) {
        const p = e.pointAt(s);
        expect(nordkapMask(p.x, p.z), `${e.id} @ ${s}`).toBe(0);
      }
    }
  });

  it('die Küstenstraße ist wellig, bleibt auf den Klippen und trocken', () => {
    let total = 0;
    let climb = 0;
    for (const e of kapEdges) {
      total += e.length;
      for (let s = 0; s + 10 <= e.length; s += 10) climb += Math.abs(e.heightAt(s + 10) - e.heightAt(s));
      for (let s = 0; s <= e.length; s += 5) {
        const p = e.pointAt(s);
        expect(p.y, `${e.id} @ ${s}`).toBeGreaterThan(100);
        expect(raw.sample(p.x, p.z), `${e.id} @ ${s}`).toBeGreaterThan(20);
      }
    }
    expect(total).toBeGreaterThan(7000);
    // Im Mittel zwischen 3 und 7 % (auf und ab zusammen)
    expect(climb / total).toBeGreaterThan(0.03);
    expect(climb / total).toBeLessThan(0.07);
  });

  it('das Zeitfahren Kaprunde ist ein Rundkurs über Kapdorf', () => {
    const [seg] = resolveSegments(roads, MVP_SEGMENTS.filter((s) => s.id === 'tt-kaprunde'));
    expect(seg!.nodes[0]).toBe('kapdorf');
    expect(seg!.nodes[seg!.nodes.length - 1]).toBe('kapdorf');
    expect(seg!.length).toBeGreaterThan(2000);
  });
});
