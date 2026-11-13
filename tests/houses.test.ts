import { describe, expect, it } from 'vitest';
import { createHouseVariants, SURF, TOWNHOUSE_DEPTH, TOWNHOUSE_WIDTHS } from '../src/game/houses';
import { rectsOverlap } from '../src/game/props';
import { mulberry32 } from '../src/world/random';

describe('Hausvarianten', () => {
  const v = createHouseVariants(mulberry32(7));

  it('gibt es für jede Stadthausbreite, mit und ohne Laden', () => {
    for (const w of TOWNHOUSE_WIDTHS) {
      expect(v.townhouses.filter((h) => h.width === w).length).toBeGreaterThan(0);
      expect(v.townhouseShops.some((h) => h.width === w)).toBe(true);
    }
    for (const h of [...v.townhouses, ...v.townhouseShops]) expect(h.depth).toBe(TOWNHOUSE_DEPTH);
  });

  it('haben Oberflächen für den Shader (Putz, Dach, Glas)', () => {
    for (const h of [...v.houses, ...v.townhouses]) {
      const surf = h.geometry.getAttribute('surf');
      expect(surf).toBeDefined();
      const kinds = new Set<number>();
      for (let i = 0; i < surf.count; i++) kinds.add(surf.getX(i));
      expect(kinds.has(SURF.roof)).toBe(true);
      expect(kinds.has(SURF.glass)).toBe(true);
      expect(kinds.has(SURF.plaster) || kinds.has(SURF.timber)).toBe(true);
    }
  });

  it('Schaufenster passen in die Hausbreite', () => {
    for (const h of v.townhouseShops) {
      const s = h.shop!;
      expect(s.x - s.width / 2).toBeGreaterThan(-h.width / 2);
      expect(s.x + s.width / 2).toBeLessThan(h.door.x - 0.5);
    }
  });
});

describe('rectsOverlap', () => {
  const r = (x: number, z: number, angle: number, hw: number, hd: number) => ({ x, z, ax: Math.cos(angle), az: Math.sin(angle), hw, hd });

  it('erkennt Überlappung und Abstand achsparalleler Rechtecke', () => {
    expect(rectsOverlap(r(0, 0, 0, 3, 4), r(5.9, 0, 0, 3, 4))).toBe(true);
    expect(rectsOverlap(r(0, 0, 0, 3, 4), r(6.1, 0, 0, 3, 4))).toBe(false);
    expect(rectsOverlap(r(0, 0, 0, 3, 4), r(0, 8.1, 0, 3, 4))).toBe(false);
  });

  it('berücksichtigt die Drehung', () => {
    // Um 45° gedreht reicht das Quadrat weiter in die Diagonale
    expect(rectsOverlap(r(0, 0, Math.PI / 4, 1, 1), r(2.3, 0, 0, 1, 1))).toBe(true);
    expect(rectsOverlap(r(0, 0, 0, 1, 1), r(2.3, 0, 0, 1, 1))).toBe(false);
  });
});
