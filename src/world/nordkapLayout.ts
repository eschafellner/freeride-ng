import type { LayoutEdge, LayoutNode } from './roadLayout';

/**
 * Wege am Nordkap (ab Level 5), siehe docs/welt.md.
 *
 * Eine wellige Küstenstraße läuft vom Oberseeblick (Spiegelseen) auf der Hochfläche über
 * den Klippen nach Osten: an der Möwenbucht vorbei, unter dem Kogel entlang zum Kap mit
 * dem Leuchtturm, weiter nach Kapdorf und zur Robbenbucht. Die Heidestraße führt zurück
 * nach Kapdorf (Rundkurs), der Heideweg hinunter zum Glutplateau (Glutsteppe). Zusammen
 * mit Spiegelseen und Glutsteppe ergibt das eine große Inselrunde.
 * Die Form der Küste (Buchten, Kap) steht in `terrainGen.ts` (`NORDKAP`, `COVES`, `CAPE`).
 */

const node = (id: string, x: number, z: number, name?: string): LayoutNode => ({ id, x, z, region: 'nordkap', ...(name ? { name } : {}) });

export const NORDKAP_NODES: LayoutNode[] = [
  node('moewenbucht', -1010, -2995, 'Möwenbucht'),
  node('kapkreuz', 420, -3235),
  node('leuchtturm', 385, -3385, 'Leuchtturm'),
  node('kapdorf', 860, -3025, 'Kapdorf'),
  node('robbenbucht', 1540, -3025, 'Robbenbucht'),
  node('heidekreuz', 1870, -2890),
];

const edge = (id: string, from: string, to: string, via: [number, number][], name?: string, surface?: LayoutEdge['surface']): LayoutEdge => ({
  id, from, to, via, region: 'nordkap', ...(name ? { name } : {}), ...(surface ? { surface } : {}),
});

export const NORDKAP_EDGES: LayoutEdge[] = [
  edge('nordstrasse', 'oberseeblick', 'moewenbucht', [[-1880, -2790], [-1650, -2840], [-1430, -2860], [-1260, -2960]], 'Nordstraße'),
  edge('klippenstrasse', 'moewenbucht', 'kapkreuz', [[-880, -3030], [-750, -3150], [-600, -3225], [-400, -3255], [-150, -3250], [100, -3255], [280, -3260]], 'Klippenstraße'),
  edge('leuchtturmweg', 'kapkreuz', 'leuchtturm', [[395, -3310]], 'Leuchtturmweg'),
  edge('kapstrasse', 'kapkreuz', 'kapdorf', [[560, -3200], [700, -3130]], 'Kapstraße'),
  edge('robbenstrasse', 'kapdorf', 'robbenbucht', [[1050, -3110], [1250, -3165], [1410, -3110]], 'Robbenstraße'),
  edge('ostklippen', 'robbenbucht', 'heidekreuz', [[1660, -3060], [1790, -3010]], 'Ostklippen'),
  edge('heidestrasse', 'heidekreuz', 'kapdorf', [[1600, -2860], [1300, -2900], [1050, -2960]], 'Heidestraße'),
  edge('heideweg', 'heidekreuz', 'plateau', [[1980, -2550], [2020, -2150], [1960, -1800], [2050, -1450]], 'Heideweg'),
];
