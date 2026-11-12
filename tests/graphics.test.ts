import { describe, expect, it } from 'vitest';
import { loadSettings, PRESETS, presetSettings, sanitizeSettings } from '../src/game/quality';
import { createTerrainMesh } from '../src/game/terrainMesh';
import { Heightfield } from '../src/world/heightfield';
import { buildRoadNetwork } from '../src/world/roadNetwork';

/** Kleines, unebenes Gelände mit einem Weg. */
function smallWorld() {
  const res = 13;
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) data[j * res + i] = 5 + Math.sin(i * 1.3) * 4 + Math.cos(j * 0.7 + i) * 3;
  const terrain = new Heightfield(240, res, data);
  const roads = buildRoadNetwork(
    { nodes: [{ id: 'a', x: -100, z: 0 }, { id: 'b', x: 100, z: 10 }], edges: [{ id: 'ab', from: 'a', to: 'b' }] },
    terrain,
  );
  return { terrain, roads };
}

describe('Geländehöhe für Gras und Wasser', () => {
  const { terrain, roads } = smallWorld();
  const { mesh, ground } = createTerrainMesh(terrain, roads, 1);
  const pos = mesh.geometry.getAttribute('position');

  it('stimmt an den Gitterpunkten', () => {
    for (let j = 0; j < terrain.res; j += 3) {
      for (let i = 0; i < terrain.res; i += 3) {
        expect(terrain.meshHeight(terrain.worldX(i), terrain.worldZ(j))).toBeCloseTo(terrain.get(i, j), 5);
      }
    }
  });

  it('liegt genau auf den Dreiecken des Geländemeshes', () => {
    for (let t = 0; t < pos.count / 3; t++) {
      const v = [0, 1, 2].map((k) => ({ x: pos.getX(t * 3 + k), y: pos.getY(t * 3 + k), z: pos.getZ(t * 3 + k) }));
      // Schwerpunkt des Dreiecks: Höhe der Ebene = Mittel der Ecken
      const cx = (v[0]!.x + v[1]!.x + v[2]!.x) / 3;
      const cz = (v[0]!.z + v[1]!.z + v[2]!.z) / 3;
      const cy = (v[0]!.y + v[1]!.y + v[2]!.y) / 3;
      expect(terrain.meshHeight(cx, cz)).toBeCloseTo(cy, 4);
    }
  });

  it('Bodendaten: eine Zelle pro Gitterquadrat, Grasanteil gesetzt', () => {
    expect(ground.cells).toBe(terrain.res - 1);
    expect(ground.rgba.length).toBe(ground.cells * ground.cells * 4);
    const alphas = new Set<number>();
    for (let k = 3; k < ground.rgba.length; k += 4) alphas.add(ground.rgba[k]!);
    expect(alphas.size).toBeGreaterThan(1);
  });
});

describe('Grafik-Einstellungen', () => {
  it('URL-Parameter hat Vorrang, sonst Mittel', () => {
    expect(loadSettings('?quality=hoch').preset).toBe('hoch');
    expect(loadSettings('?quality=quatsch').preset).toBe('mittel');
    expect(loadSettings('')).toEqual(presetSettings('mittel'));
  });

  it('höhere Stufen kosten mehr, nie weniger', () => {
    const { niedrig: n, mittel: m, hoch: h } = PRESETS;
    expect(n.grassDistance).toBe(0);
    expect(m.shadowMapSize).toBeGreaterThan(n.shadowMapSize);
    expect(h.shadowMapSize).toBeGreaterThan(m.shadowMapSize);
    expect(h.grassDistance).toBeGreaterThan(m.grassDistance);
    expect(h.ao && !m.ao && !n.ao).toBe(true);
  });

  it('gespeicherte Werte werden geprüft und begrenzt', () => {
    const s = sanitizeSettings({
      preset: 'eigene', pixelRatio: 9, shadowMapSize: 1234, grassDistance: 150,
      grassDensity: 'viel', waveCell: 8, ao: 'ja', bloom: true,
    });
    expect(s).toEqual({
      preset: 'eigene', pixelRatio: 2, shadowMapSize: 2048, grassDistance: 150,
      grassDensity: 6, waveCell: 8, ao: false, bloom: true, hud: 'standard',
    });
    expect(sanitizeSettings(null)).toEqual(presetSettings('mittel'));
  });
});
