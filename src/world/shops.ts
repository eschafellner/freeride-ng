/**
 * Geschäfte, Cafés und Restaurants: welche Gebäude ein Ladenlokal bekommen.
 *
 * Verteilung nach Lage statt Zufall, wie in einer echten Kleinstadt:
 * - Ortskern (um den Marktplatz): dichteste Ladenzeile, Dichte fällt nach außen ab
 * - Hafen und Promenade: Eisdiele, Fischimbiss, Restaurants, Cafés
 * - Dörfer: wenige, typische Läden (Weinstube, Dorfladen, Gasthaus, Bäckerei)
 * - Land: Hofläden an Scheunen
 * Regeln: nie zwei gleiche Läden nahe beieinander, ein Fahrradladen pro Ort,
 * Obergrenzen je Art und Ort, jeder Name höchstens einmal pro Ort.
 */

export type ShopType =
  | 'fahrrad' | 'cafe' | 'restaurant' | 'baecker' | 'mode' | 'buch' | 'blumen'
  | 'eis' | 'fisch' | 'weinstube' | 'dorfladen' | 'gasthaus' | 'hofladen';

export type District = 'kern' | 'stadt' | 'hafen' | 'dorf' | 'land';

/** Ein Gebäude, das ein Laden werden kann. */
export interface ShopSlot {
  id: number;
  x: number;
  z: number;
  district: District;
  /** Ort, zu dem das Gebäude gehört (für „ein Fahrradladen pro Ort“). */
  town: string;
  /** Abstand zum Ortsmittelpunkt in m. */
  centerDist: number;
  /** Scheune (nur Hofläden). */
  barn: boolean;
}

export interface ShopAssignment {
  slot: number;
  type: ShopType;
  name: string;
}

export const SHOP_LABEL: Record<ShopType, string> = {
  fahrrad: 'Fahrradladen', cafe: 'Café', restaurant: 'Restaurant', baecker: 'Bäckerei', mode: 'Mode',
  buch: 'Buchhandlung', blumen: 'Blumenladen', eis: 'Eisdiele', fisch: 'Fischimbiss',
  weinstube: 'Weinstube', dorfladen: 'Dorfladen', gasthaus: 'Gasthaus', hofladen: 'Hofladen',
};

/** Eigene, erfundene Namen für die Schilder. */
export const SHOP_NAMES: Record<ShopType, string[]> = {
  fahrrad: ['Radhaus Velara', 'Speiche & Kette', 'Zweirad Lumen', 'Radwerk', 'Pedal & Co.'],
  cafe: ['Café am Markt', 'Café Möwe', 'Kaffeehaus Lumen', 'Café Sonnenseite', 'Café Kompass', 'Café Uferweg'],
  restaurant: ['Zum Leuchtfeuer', 'Trattoria Mare', 'Restaurant Anker', 'Bistro Platane', 'Zur alten Waage'],
  baecker: ['Bäckerei Korn', 'Backstube Lumen', 'Brot & Butter', 'Bäckerei Ofenwarm'],
  mode: ['Mode Velara', 'Kleiderhaus', 'Faden & Stoff', 'Lumen Mode'],
  buch: ['Buchhandlung Seite', 'Lesezeichen', 'Bücherinsel'],
  blumen: ['Blumen Flora', 'Blütenzauber', 'Gärtnerei Grün'],
  eis: ['Eiscafé Lido', 'Eisdiele Brise', 'Gelateria Onda'],
  fisch: ['Fischhaus Mole', 'Fang des Tages', 'Kutterstube'],
  weinstube: ['Weinstube Rebstock', 'Zur Traube', 'Weinkeller Hang'],
  dorfladen: ['Dorfladen', 'Kaufladen Huber', 'Laden am Brunnen'],
  gasthaus: ['Gasthaus zur Linde', 'Gasthof Hang', 'Zum goldenen Fass'],
  hofladen: ['Hofladen', 'Hofladen Wiesengrund', 'Frisch vom Feld', 'Hof am Rain'],
};

interface DistrictRule {
  /** Ladenanteil im Mittelpunkt und am Rand (linear dazwischen bis `radius`). */
  center: number;
  edge: number;
  radius: number;
  types: Partial<Record<ShopType, number>>;
}

const RULES: Record<District, DistrictRule> = {
  kern: { center: 0.85, edge: 0.3, radius: 260, types: { cafe: 3, restaurant: 2, baecker: 2, mode: 3, buch: 1.5, blumen: 1.5, fahrrad: 1, eis: 1 } },
  stadt: { center: 0.2, edge: 0.05, radius: 450, types: { baecker: 2, cafe: 1, blumen: 1, restaurant: 1, fahrrad: 1 } },
  hafen: { center: 0.7, edge: 0.25, radius: 240, types: { eis: 3, fisch: 3, restaurant: 3, cafe: 2, mode: 1 } },
  dorf: { center: 0.5, edge: 0.1, radius: 150, types: { weinstube: 3, dorfladen: 2, gasthaus: 2, baecker: 1.5, cafe: 1, fahrrad: 1 } },
  land: { center: 0.4, edge: 0.4, radius: 1, types: { hofladen: 1 } },
};

/** Höchstens so viele Läden einer Art pro Ort. */
export const MAX_PER_TOWN: Record<ShopType, number> = {
  fahrrad: 1, cafe: 6, restaurant: 5, baecker: 3, mode: 4, buch: 2, blumen: 2,
  eis: 3, fisch: 3, weinstube: 1, dorfladen: 1, gasthaus: 1, hofladen: 4,
};

/** Gleiche Läden müssen mindestens so weit auseinander liegen (m). */
export const SAME_TYPE_SPACING = 70;

type Rng = () => number;

/**
 * Wählt für jedes Gebäude, ob und welcher Laden es wird.
 * Ein Fahrradladen pro Ort ist gesetzt (das zentrumsnächste passende Gebäude),
 * danach entscheidet die Lage über Dichte und Art.
 */
export function assignShops(slots: ShopSlot[], rng: Rng): ShopAssignment[] {
  const out: ShopAssignment[] = [];
  const taken = new Set<number>();
  const usedNames = new Map<string, Set<string>>();
  const count = new Map<string, number>();
  const key = (town: string, type: ShopType) => `${town}|${type}`;
  const add = (slot: ShopSlot, type: ShopType) => {
    // Namen pro Ort nur einmal; zufälliger Einstieg in die Liste
    const names = SHOP_NAMES[type];
    const used = usedNames.get(key(slot.town, type)) ?? new Set<string>();
    const start = Math.floor(rng() * names.length);
    let name = names[start]!;
    for (let k = 0; k < names.length; k++) {
      const candidate = names[(start + k) % names.length]!;
      if (!used.has(candidate)) {
        name = candidate;
        break;
      }
    }
    used.add(name);
    usedNames.set(key(slot.town, type), used);
    count.set(key(slot.town, type), (count.get(key(slot.town, type)) ?? 0) + 1);
    out.push({ slot: slot.id, type, name });
    taken.add(slot.id);
  };
  const full = (slot: ShopSlot, type: ShopType) => (count.get(key(slot.town, type)) ?? 0) >= MAX_PER_TOWN[type];
  const tooClose = (slot: ShopSlot, type: ShopType) =>
    out.some((a) => {
      if (a.type !== type) return false;
      const o = slots.find((s) => s.id === a.slot)!;
      return Math.hypot(o.x - slot.x, o.z - slot.z) < SAME_TYPE_SPACING;
    });

  // 1. Ein Fahrradladen pro Ort, nahe der Mitte, aber nicht direkt am Platz
  const towns = new Set(slots.filter((s) => !s.barn && s.district !== 'land').map((s) => s.town));
  for (const town of towns) {
    const candidates = slots
      .filter((s) => s.town === town && !s.barn && s.district !== 'land' && RULES[s.district].types.fahrrad)
      .sort((a, b) => Math.abs(a.centerDist - 90) - Math.abs(b.centerDist - 90));
    if (candidates[0]) add(candidates[0], 'fahrrad');
  }

  // 2. Übrige Läden nach Lage, von innen nach außen (der Kern füllt sich zuerst)
  const order = [...slots].sort((a, b) => a.centerDist - b.centerDist);
  for (const slot of order) {
    if (taken.has(slot.id)) continue;
    const rule = RULES[slot.district];
    const t = Math.min(1, slot.centerDist / rule.radius);
    const chance = rule.center + (rule.edge - rule.center) * t;
    if (rng() >= chance) continue;
    // Gewichtete Wahl unter den erlaubten Arten, ohne Fahrrad (schon gesetzt) und ohne Nachbarn gleicher Art
    const options = (Object.entries(rule.types) as [ShopType, number][])
      .filter(([type]) => type !== 'fahrrad' && (type === 'hofladen') === slot.barn && !full(slot, type) && !tooClose(slot, type));
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) continue;
    let r = rng() * total;
    for (const [type, w] of options) {
      r -= w;
      if (r <= 0) {
        add(slot, type);
        break;
      }
    }
  }
  return out;
}

/** Laden mit Außenbereich (Tische, Bänke) statt nur Auslage. */
export function hasTerrace(type: ShopType): boolean {
  return type === 'cafe' || type === 'restaurant' || type === 'eis' || type === 'gasthaus' || type === 'weinstube';
}
