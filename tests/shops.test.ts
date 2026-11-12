import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/world/random';
import { assignShops, MAX_PER_TOWN, SAME_TYPE_SPACING, SHOP_NAMES, type ShopSlot, type ShopType } from '../src/world/shops';

/** Stadt mit Kern (Gitter um 0,0), Hafen im Süden, ein Dorf und Scheunen. */
function slots(): ShopSlot[] {
  const out: ShopSlot[] = [];
  const add = (s: Omit<ShopSlot, 'id'>) => out.push({ ...s, id: out.length });
  for (let x = -300; x <= 300; x += 15) {
    for (const z of [-12, 12]) {
      const d = Math.hypot(x, z);
      add({ x, z, district: d < 260 ? 'kern' : 'stadt', town: 'lumen', centerDist: d, barn: false });
    }
  }
  for (let x = -200; x <= 200; x += 15) add({ x, z: 400, district: 'hafen', town: 'lumen', centerDist: Math.abs(x), barn: false });
  for (let x = 2000; x <= 2200; x += 15) add({ x, z: 0, district: 'dorf', town: 'rebdorf', centerDist: Math.abs(x - 2100), barn: false });
  for (let k = 0; k < 8; k++) add({ x: 5000 + k * 300, z: 0, district: 'land', town: 'land', centerDist: 0, barn: true });
  return out;
}

describe('Ladenverteilung', () => {
  const all = slots();
  const shops = assignShops(all, mulberry32(42));
  const at = (id: number) => all.find((s) => s.id === id)!;

  it('genau ein Fahrradladen pro Ort, keiner auf dem Land', () => {
    const bikes = shops.filter((s) => s.type === 'fahrrad').map((s) => at(s.slot).town).sort();
    expect(bikes).toEqual(['lumen', 'rebdorf']);
  });

  it('gleiche Läden liegen nie direkt beieinander', () => {
    for (const a of shops) {
      for (const b of shops) {
        if (a === b || a.type !== b.type) continue;
        const d = Math.hypot(at(a.slot).x - at(b.slot).x, at(a.slot).z - at(b.slot).z);
        expect(d).toBeGreaterThanOrEqual(SAME_TYPE_SPACING);
      }
    }
  });

  it('Scheunen werden nur Hofläden, Hofläden nur Scheunen', () => {
    for (const s of shops) expect(s.type === 'hofladen').toBe(at(s.slot).barn);
  });

  it('Läden passen zur Lage', () => {
    for (const s of shops) {
      const district = at(s.slot).district;
      if (district === 'hafen') expect(['eis', 'fisch', 'restaurant', 'cafe', 'mode']).toContain(s.type);
      if (district === 'dorf') expect(['weinstube', 'dorfladen', 'gasthaus', 'baecker', 'cafe', 'fahrrad']).toContain(s.type);
    }
  });

  it('im Kern dichter als am Stadtrand, aber nicht jedes Haus', () => {
    const share = (f: (s: ShopSlot) => boolean) => {
      const group = all.filter(f);
      return shops.filter((s) => f(at(s.slot))).length / group.length;
    };
    const inner = share((s) => s.district === 'kern' && s.centerDist < 120);
    const outer = share((s) => s.district === 'stadt');
    expect(inner).toBeGreaterThan(outer);
    expect(inner).toBeLessThan(1);
    expect(shops.length).toBeLessThan(all.length / 2);
  });

  it('Obergrenzen je Ort und Namen pro Ort nur einmal', () => {
    const perTown = new Map<string, number>();
    const names = new Set<string>();
    for (const s of shops) {
      const k = `${at(s.slot).town}|${s.type}`;
      perTown.set(k, (perTown.get(k) ?? 0) + 1);
      const n = `${at(s.slot).town}|${s.name}`;
      expect(names.has(n)).toBe(false);
      names.add(n);
    }
    for (const [k, n] of perTown) expect(n).toBeLessThanOrEqual(MAX_PER_TOWN[k.split('|')[1] as ShopType]);
  });

  it('Namen reichen für die Obergrenzen', () => {
    for (const [type, max] of Object.entries(MAX_PER_TOWN)) expect(SHOP_NAMES[type as ShopType].length).toBeGreaterThanOrEqual(max);
  });

  it('Namen stammen aus der Liste, gleicher Seed → gleiche Verteilung', () => {
    for (const s of shops) expect(SHOP_NAMES[s.type]).toContain(s.name);
    expect(assignShops(all, mulberry32(42))).toEqual(shops);
  });
});
