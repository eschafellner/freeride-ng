import { smoothstep } from './random';

/**
 * Bergseen der Spiegelseen (Nordwesten, siehe docs/welt.md). Jeder See hat eine eigene,
 * feste Wasserhöhe. Die Uferlinie setzt sich aus einer oder mehreren gedrehten Ellipsen
 * („Becken“) zusammen und ist leicht gewellt. Reines TS, damit Gelände, Platzierung,
 * Karte und Wasser dieselbe Form benutzen.
 */

export interface LakeLobe {
  x: number;
  z: number;
  /** Halbachsen in m (rx entlang der Drehrichtung). */
  rx: number;
  rz: number;
  /** Drehung der Hauptachse in rad (0 = nach Osten, positiv = nach Süden). */
  rot: number;
}

export interface LakeDef {
  id: string;
  name: string;
  /** Wasserspiegel in m über dem Meer. */
  level: number;
  /** Größte Tiefe in m. */
  depth: number;
  lobes: LakeLobe[];
}

export const LAKES: LakeDef[] = [
  {
    id: 'untersee', name: 'Untersee', level: 158, depth: 7,
    lobes: [{ x: -1700, z: -1160, rx: 235, rz: 130, rot: 0.35 }],
  },
  {
    id: 'spiegelsee', name: 'Spiegelsee', level: 168, depth: 11,
    lobes: [
      { x: -2170, z: -1730, rx: 295, rz: 175, rot: -0.55 },
      { x: -1805, z: -1980, rx: 290, rz: 165, rot: 0.15 },
    ],
  },
  {
    id: 'obersee', name: 'Obersee', level: 176, depth: 8,
    lobes: [{ x: -2050, z: -2540, rx: 270, rz: 135, rot: 0.12 }],
  },
];

/** Bis zu diesem Formwert (1 = Uferlinie) reicht das Wassernetz über das Ufer hinaus. */
export const LAKE_MESH_EXTENT = 1.12;

/** Leichte Wellung der Uferlinie, abhängig vom Winkel um die Beckenmitte. */
export function shoreWobble(ang: number, seed: number): number {
  return 1 + 0.07 * Math.sin(ang * 3 + seed) + 0.04 * Math.sin(ang * 5 - seed * 1.7) + 0.025 * Math.sin(ang * 9 + seed * 0.3);
}

/** Startwert der Wellung je Becken. */
export const lobeSeed = (lake: LakeDef, lobe: number): number => lobe * 2.3 + lake.level * 0.1;

/**
 * Formwert eines Sees an einem Punkt: < 1 im Wasser, 1 an der Uferlinie, > 1 an Land.
 * Bei mehreren Becken zählt das nächste.
 */
export function lakeShape(lake: LakeDef, x: number, z: number): number {
  let best = Infinity;
  lake.lobes.forEach((l, k) => {
    const dx = x - l.x;
    const dz = z - l.z;
    const c = Math.cos(l.rot);
    const s = Math.sin(l.rot);
    const u = (dx * c + dz * s) / l.rx;
    const v = (-dx * s + dz * c) / l.rz;
    const e = Math.hypot(u, v) / shoreWobble(Math.atan2(v, u), lobeSeed(lake, k));
    if (e < best) best = e;
  });
  return best;
}

/** Nächster See und sein Formwert (für Punkte weit weg von allen Seen: e = Infinity). */
export function nearestLake(x: number, z: number): { lake: LakeDef | null; e: number } {
  let lake: LakeDef | null = null;
  let e = Infinity;
  for (const l of LAKES) {
    const v = lakeShape(l, x, z);
    if (v < e) {
      e = v;
      lake = l;
    }
  }
  return { lake, e };
}

/** Wasserspiegel an einem Punkt: Seehöhe innerhalb eines Sees, sonst das Meer (0 m). */
export function waterLevelAt(x: number, z: number): number {
  const { lake, e } = nearestLake(x, z);
  return lake && e < 1 ? lake.level : 0;
}

/** Liegt ein Punkt mit Geländehöhe h unter Wasser (Meer oder See)? */
export function isUnderWater(x: number, z: number, h: number, margin = 0): boolean {
  return h < waterLevelAt(x, z) + margin;
}

/**
 * Geländehöhe eines Seebeckens über dem Formwert: flacher Grund, steiler werdend zum Ufer,
 * an der Uferlinie knapp unter Wasser, dahinter ein flacher Uferstreifen bis 3 m über dem Spiegel.
 */
export function lakeBasinHeight(lake: LakeDef, e: number): number {
  if (e < 1) return lake.level - 0.6 - lake.depth * smoothstep(0.97, 0.45, e);
  return lake.level - 0.6 + 3.6 * smoothstep(1, 1.25, e);
}

/** Wie stark das Seebecken das Gelände bestimmt (1 am See, 0 ab 1,6, dort gilt die Hochfläche). */
export function lakeBasinWeight(e: number): number {
  return 1 - smoothstep(1.15, 1.6, e);
}
