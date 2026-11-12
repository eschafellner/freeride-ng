import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/world/heightfield';
import { RiderOnNetwork } from '../src/world/rider';
import { buildRoadNetwork } from '../src/world/roadNetwork';

// W – K – O geradeaus, bei K zweigt N nach Norden ab
const net = buildRoadNetwork(
  {
    nodes: [{ id: 'W', x: -200, z: 0 }, { id: 'K', x: 0, z: 0 }, { id: 'O', x: 200, z: 0 }, { id: 'N', x: 0, z: -200 }],
    edges: [{ id: 'wk', from: 'W', to: 'K' }, { id: 'ko', from: 'K', to: 'O' }, { id: 'kn', from: 'K', to: 'N' }],
  },
  new Heightfield(1000, 51, new Float32Array(51 * 51).fill(10)),
);

describe('Blick voraus (Kamera)', () => {
  it('folgt dem Weg und bewegt den Fahrer nicht', () => {
    const r = new RiderOnNetwork(net, 'wk', 50, 1);
    const p = r.pointAhead(30);
    expect(p.x).toBeCloseTo(-200 + 80, 0);
    expect(r.s).toBe(50);
  });

  it('geht über Kreuzungen, standardmäßig geradeaus, sonst nach Vorschau', () => {
    const r = new RiderOnNetwork(net, 'wk', 190, 1);
    const straight = r.pointAhead(30);
    expect(straight.x).toBeGreaterThan(10);
    expect(Math.abs(straight.z)).toBeLessThan(1);
    const left = r.pointAhead(30, (_n, exits) => exits.find((e) => e.edge.id === 'kn')!);
    expect(left.z).toBeLessThan(-10);
    expect(Math.abs(left.x)).toBeLessThan(1);
    // Fahrer selbst unverändert, Kreuzung nicht „verbraucht“
    expect(r.edge.id).toBe('wk');
  });
});
