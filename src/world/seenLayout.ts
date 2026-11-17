import { LAKES, lobeSeed, shoreWobble, type LakeDef } from './lakes';
import type { LayoutEdge, LayoutNode } from './roadLayout';

/**
 * Wege an den Spiegelseen (ab Level 4), siehe docs/welt.md.
 *
 * Die Uferwege laufen in festem Abstand um die Seen: Ihre Stützpunkte werden aus der
 * Seeform in `lakes.ts` berechnet. Verschiebt man einen See, wandern Ufer und Wege mit.
 * Die Waldwege dazwischen und die Seebrücke sind von Hand gelegt.
 *
 * - Seeweg (Forsthaus → Seedorf): Zufahrt von der Waldstraße bei Rebland
 * - Unterseeweg und Waldstraße: um den Untersee, weiter zur Westbucht
 * - Spiegelsee: Ufer-Rundweg mit vier Abschnitten, quer darüber die **Seebrücke**
 * - Obersee: Ostweg hinauf, Ufer-Rundweg mit Blick aufs Nordmeer, Klippenweg zurück
 */

const lake = (id: string): LakeDef => LAKES.find((l) => l.id === id)!;

/**
 * Punkt am Ufer eines Seebeckens, `off` m außerhalb der Uferlinie.
 * @param deg Winkel im Becken: 0 = Ende der Hauptachse, 90 = „unten“ (bei rot = 0 nach Süden)
 */
export function shorePoint(lakeId: string, lobe: number, deg: number, off: number): [number, number] {
  const l = lake(lakeId);
  const b = l.lobes[lobe]!;
  const a = (deg * Math.PI) / 180;
  const w = shoreWobble(a, lobeSeed(l, lobe));
  const u = Math.cos(a) * (b.rx * w + off);
  const v = Math.sin(a) * (b.rz * w + off);
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return [Math.round(b.x + u * c - v * s), Math.round(b.z + u * s + v * c)];
}

/** Uferpunkte über mehrere Winkel. */
const ring = (lakeId: string, lobe: number, degs: number[], off = 45): [number, number][] =>
  degs.map((d) => shorePoint(lakeId, lobe, d, off));

const at = (id: string, p: [number, number], name?: string, gate?: boolean): LayoutNode => ({
  id, x: p[0], z: p[1], ...(name ? { name } : {}), ...(gate ? { gate } : { region: 'seen' }),
});

/** Knoten am Rand des Gebiets: Abzweig von der Waldstraße (Schranke, gehört zu Rebland). */
export const FORSTHAUS: LayoutNode = { id: 'forsthaus', x: -1250, z: -700, name: 'Forsthaus', gate: true };

export const SEEN_NODES: LayoutNode[] = [
  at('seedorf', shorePoint('untersee', 0, 100, 125), 'Seedorf'),
  at('seespitz', shorePoint('untersee', 0, -85, 50)),
  at('ostbucht', shorePoint('spiegelsee', 1, 8, 55), 'Ostbucht'),
  at('westbucht', shorePoint('spiegelsee', 0, 180, 55), 'Westbucht'),
  // Enden der Seebrücke an der Engstelle zwischen den beiden Becken
  { id: 'seesteg-s', x: -1913, z: -1824, region: 'seen' },
  { id: 'seesteg-n', x: -2082, z: -2071, region: 'seen' },
  at('oberseeost', shorePoint('obersee', 0, 0, 55)),
  at('oberseeblick', shorePoint('obersee', 0, -95, 45), 'Oberseeblick'),
  at('oberseewest', shorePoint('obersee', 0, 180, 55)),
];

const edge = (id: string, from: string, to: string, via: [number, number][], name?: string, surface?: LayoutEdge['surface']): LayoutEdge => ({
  id, from, to, via, region: 'seen', ...(name ? { name } : {}), ...(surface ? { surface } : {}),
});

export const SEEN_EDGES: LayoutEdge[] = [
  edge('seeweg', 'forsthaus', 'seedorf', [[-1360, -760], [-1470, -850]], 'Seeweg'),
  // Untersee: Ostufer zur Seespitz, Westufer weiter zur Westbucht
  edge('unterseeweg', 'seedorf', 'seespitz', ring('untersee', 0, [60, 25, -10, -45]), 'Unterseeweg', 'gravel'),
  edge('waldstrasse', 'seedorf', 'westbucht', [
    ...ring('untersee', 0, [140, 175, 205], 50), [-2110, -1330], [-2330, -1390],
  ], 'Waldstraße'),
  edge('ostuferweg', 'seespitz', 'ostbucht', [[-1560, -1480], [-1490, -1660], [-1470, -1820]], 'Ostuferweg'),
  // Spiegelsee: Rundweg in vier Abschnitten, die Seebrücke verbindet Süd- und Nordufer
  edge('suedufer-w', 'westbucht', 'seesteg-s', [...ring('spiegelsee', 0, [155, 125, 95]), shorePoint('spiegelsee', 0, 62, 85)], 'Südufer'),
  edge('suedufer-o', 'seesteg-s', 'ostbucht', ring('spiegelsee', 1, [95, 65, 38]), 'Südufer'),
  edge('nordufer-o', 'seesteg-n', 'ostbucht', ring('spiegelsee', 1, [-150, -120, -90, -60, -30]), 'Nordufer', 'gravel'),
  edge('nordufer-w', 'westbucht', 'seesteg-n', ring('spiegelsee', 0, [-155, -125, -95, -68]), 'Nordufer', 'gravel'),
  edge('seebruecke', 'seesteg-s', 'seesteg-n', [], 'Seebrücke', 'bridge'),
  // Obersee
  edge('oberseeweg', 'ostbucht', 'oberseeost', [[-1450, -2080], [-1520, -2280], [-1640, -2440]], 'Oberseeweg'),
  edge('obersee-s', 'oberseeost', 'oberseewest', ring('obersee', 0, [35, 65, 95, 125, 150]), 'Obersee'),
  edge('obersee-n', 'oberseeost', 'oberseeblick', ring('obersee', 0, [-30, -60]), 'Obersee', 'gravel'),
  edge('obersee-nw', 'oberseeblick', 'oberseewest', ring('obersee', 0, [-125, -155]), 'Obersee', 'gravel'),
  edge('klippenweg', 'oberseewest', 'westbucht', [[-2450, -2380], [-2480, -2150], [-2490, -1900], [-2470, -1700]], 'Klippenweg'),
];
