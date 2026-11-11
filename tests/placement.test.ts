import { describe, expect, it } from 'vitest';
import { distanceToRoad, fieldAt, REBLAND, roadside, vineyardRows } from '../src/world/placement';
import { createWorld } from '../src/world/world';

const world = createWorld();

describe('Weinberge', () => {
  const rows = vineyardRows(world.terrain, world.roads, world.seed);

  it('es gibt eine nennenswerte Zahl an Rebzeilen', () => {
    expect(rows.length).toBeGreaterThan(150);
  });

  it('liegen im Rebland', () => {
    for (const r of rows) {
      const mx = (r.x1 + r.x2) / 2;
      const mz = (r.z1 + r.z2) / 2;
      expect(Math.hypot(mx - REBLAND.x, mz - REBLAND.z)).toBeLessThan(REBLAND.radius + 60);
    }
  });

  it('kreuzen keinen Weg', () => {
    for (const r of rows) {
      for (let t = 0; t <= 1; t += 0.25) {
        const x = r.x1 + (r.x2 - r.x1) * t;
        const z = r.z1 + (r.z2 - r.z1) * t;
        expect(world.roads.maskAt(world.terrain, x, z)).toBeLessThan(0.3);
      }
    }
  });

  it('sind deterministisch', () => {
    expect(vineyardRows(world.terrain, world.roads, world.seed)).toEqual(rows);
  });
});

describe('roadside', () => {
  it('setzt Objekte im gewünschten Abstand neben den Weg', () => {
    const e = world.roads.edge('markt-w');
    const pts = roadside(world.terrain, world.roads, {
      spacing: 20, offset: 5, sides: [1], edgeFilter: (x) => x === e,
    });
    expect(pts.length).toBeGreaterThan(5);
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i < e.count; i++) best = Math.min(best, Math.hypot(e.xs[i]! - p.x, e.zs[i]! - p.z));
      expect(best).toBeGreaterThan(4.5);
      expect(best).toBeLessThan(5.5);
    }
  });

  it('nichts steht auf einem anderen Weg', () => {
    const pts = roadside(world.terrain, world.roads, { spacing: 10, offset: 5, sides: [1, -1] });
    expect(pts.length).toBeGreaterThan(1000);
    const closest = Math.min(...pts.map((p) => distanceToRoad(world.roads, p.x, p.z)));
    expect(closest).toBeGreaterThan(4);
  });
});

describe('distanceToRoad', () => {
  it('stimmt mit der Brute-Force-Suche überein', () => {
    for (const [x, z] of [[400, 880], [0, 0], [-700, 300], [1200, -300]] as const) {
      let brute = Infinity;
      for (const e of world.roads.edges.values()) {
        for (let i = 0; i < e.count; i++) brute = Math.min(brute, Math.hypot(e.xs[i]! - x, e.zs[i]! - z));
      }
      const fast = distanceToRoad(world.roads, x, z, undefined, 2000);
      expect(fast).toBeCloseTo(brute, 6);
    }
  });
});

describe('Felder', () => {
  it('Flickenteppich aus Wiesen und vier Feldarten', () => {
    const seen = new Set<number | null>();
    for (let x = -1500; x < 1500; x += 60) for (let z = -1500; z < 1500; z += 60) seen.add(fieldAt(x + 1, z + 1, 1));
    expect(seen).toEqual(new Set([null, 0, 1, 2, 3]));
  });
  it('ist innerhalb einer Parzelle einheitlich', () => {
    expect(fieldAt(61, 61, 1)).toBe(fieldAt(119, 119, 1));
  });
});
