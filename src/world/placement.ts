import type { Heightfield } from './heightfield';
import { mulberry32 } from './random';
import type { RoadEdge, RoadNetwork } from './roadNetwork';
import { townMask } from './terrainGen';

/**
 * Platzierung von Details (reine Logik, ohne Three.js, deterministisch per Seed).
 */

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Drehung um die Hochachse in rad (0 = Blick nach +z). */
  rot: number;
}

/** Mittelpunkt und Radius des Reblands (vgl. terrainGen). */
export const REBLAND = { x: -850, z: 80, radius: 650 };

export interface VineRow {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * Weinberge: rechteckige Blöcke mit Rebzeilen entlang der Höhenlinien,
 * nur im Rebland, nicht auf Wegen, nicht zu steil.
 */
export function vineyardRows(terrain: Heightfield, roads: RoadNetwork, seed: number): VineRow[] {
  const rng = mulberry32(seed ^ 0x51ed);
  const rows: VineRow[] = [];
  const BLOCK = 70; // Rastergröße der Blöcke
  const LEN = 44; // Zeilenlänge
  const WIDTH = 30; // Blockbreite quer zu den Zeilen
  const SPACING = 2.6;

  for (let bz = REBLAND.z - REBLAND.radius; bz <= REBLAND.z + REBLAND.radius; bz += BLOCK) {
    for (let bx = REBLAND.x - REBLAND.radius; bx <= REBLAND.x + REBLAND.radius; bx += BLOCK) {
      const cx = bx + (rng() - 0.5) * 16;
      const cz = bz + (rng() - 0.5) * 16;
      if (Math.hypot(cx - REBLAND.x, cz - REBLAND.z) > REBLAND.radius) continue;
      if (rng() < 0.25) continue; // Lücken lassen: Wiesen zwischen den Weinbergen
      const h = terrain.sample(cx, cz);
      const slope = terrain.slope(cx, cz);
      if (h < 15 || slope > 0.22 || townMask(cx, cz) > 0.05) continue;

      // Zeilen quer zum Gefälle (entlang der Höhenlinie)
      const d = 4;
      const gx = terrain.sample(cx + d, cz) - terrain.sample(cx - d, cz);
      const gz = terrain.sample(cx, cz + d) - terrain.sample(cx, cz - d);
      const ang = slope > 0.01 ? Math.atan2(gz, gx) + Math.PI / 2 : rng() * Math.PI;
      const ux = Math.cos(ang); // Zeilenrichtung
      const uz = Math.sin(ang);
      const vx = -uz; // quer dazu
      const vz = ux;

      // Ganzer Block muss frei von Wegen sein (Ecken und Mitte prüfen)
      const corners = [
        [cx, cz],
        [cx + ux * LEN / 2 + vx * WIDTH / 2, cz + uz * LEN / 2 + vz * WIDTH / 2],
        [cx - ux * LEN / 2 + vx * WIDTH / 2, cz - uz * LEN / 2 + vz * WIDTH / 2],
        [cx + ux * LEN / 2 - vx * WIDTH / 2, cz + uz * LEN / 2 - vz * WIDTH / 2],
        [cx - ux * LEN / 2 - vx * WIDTH / 2, cz - uz * LEN / 2 - vz * WIDTH / 2],
      ];
      if (corners.some(([x, z]) => roads.maskAt(terrain, x!, z!) > 0.02)) continue;

      for (let off = -WIDTH / 2; off <= WIDTH / 2; off += SPACING) {
        const mx = cx + vx * off;
        const mz = cz + vz * off;
        rows.push({
          x1: mx - ux * LEN / 2, z1: mz - uz * LEN / 2,
          x2: mx + ux * LEN / 2, z2: mz + uz * LEN / 2,
        });
      }
    }
  }
  return rows;
}

export interface RoadsideOptions {
  /** Abstand entlang des Weges in m. */
  spacing: number;
  /** Seitlicher Abstand zur Wegmitte in m. */
  offset: number;
  /** Welche Seiten: 1 = rechts (in from→to-Richtung), −1 = links. */
  sides: (1 | -1)[];
  /** Nur Kanten, für die das true liefert. */
  edgeFilter?: (e: RoadEdge) => boolean;
  /** Nur Stellen, für die das true liefert. */
  pointFilter?: (x: number, z: number) => boolean;
  /** Abstand zu Knoten (Kreuzungen) in m, damit nichts auf Kreuzungen steht. */
  nodeClearance?: number;
  /** Seitenweise versetzt statt paarweise gegenüber. */
  staggered?: boolean;
}

/**
 * Objekte entlang der Wege (Laternen, Leitpfosten, Zaunfelder).
 * Stellen, die zu nah an einem *anderen* Weg liegen, werden ausgelassen.
 */
export function roadside(terrain: Heightfield, roads: RoadNetwork, o: RoadsideOptions): Placement[] {
  const out: Placement[] = [];
  const clearance = o.nodeClearance ?? 15;
  for (const e of roads.edges.values()) {
    if (o.edgeFilter && !o.edgeFilter(e)) continue;
    for (let s = clearance; s <= e.length - clearance; s += o.spacing) {
      const p = e.pointAt(s);
      const d = e.directionAt(s);
      const sides = o.staggered ? [o.sides[Math.round(s / o.spacing) % o.sides.length]!] : o.sides;
      for (const side of sides) {
        // rechts von der Fahrtrichtung (x Ost, z Süd): (−dz, dx)
        const x = p.x - d.dz * o.offset * side;
        const z = p.z + d.dx * o.offset * side;
        if (o.pointFilter && !o.pointFilter(x, z)) continue;
        // Auch der eigene Weg zählt: in engen Kehren liegt der Gegenast ganz nah
        if (nearOtherRoad(roads, undefined, x, z, o.offset - 0.5)) continue;
        out.push({ x, y: terrain.sample(x, z), z, rot: Math.atan2(d.dx, d.dz) });
      }
    }
  }
  return out;
}

/** Räumliches Raster aller Wegpunkte, je Netz einmal aufgebaut. */
const GRID_CELL = 20;
const gridCache = new WeakMap<RoadNetwork, Map<string, { edge: RoadEdge; x: number; z: number }[]>>();

function sampleGrid(roads: RoadNetwork) {
  let grid = gridCache.get(roads);
  if (grid) return grid;
  grid = new Map();
  for (const e of roads.edges.values()) {
    for (let i = 0; i < e.count; i++) {
      const key = `${Math.floor(e.xs[i]! / GRID_CELL)},${Math.floor(e.zs[i]! / GRID_CELL)}`;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push({ edge: e, x: e.xs[i]!, z: e.zs[i]! });
    }
  }
  gridCache.set(roads, grid);
  return grid;
}

/** Kleinster Abstand von (x, z) zu einem Wegpunkt, optional ohne die Kante `except`. */
export function distanceToRoad(roads: RoadNetwork, x: number, z: number, except?: RoadEdge, maxDist = 40): number {
  const grid = sampleGrid(roads);
  const r = Math.ceil(maxDist / GRID_CELL);
  const ci = Math.floor(x / GRID_CELL);
  const cj = Math.floor(z / GRID_CELL);
  let best = Infinity;
  for (let j = cj - r; j <= cj + r; j++) {
    for (let i = ci - r; i <= ci + r; i++) {
      for (const p of grid.get(`${i},${j}`) ?? []) {
        if (p.edge === except) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** Liegt (x, z) näher als `dist` an einer anderen Kante als `self`? */
function nearOtherRoad(roads: RoadNetwork, self: RoadEdge | undefined, x: number, z: number, dist: number): boolean {
  return distanceToRoad(roads, x, z, self, dist + GRID_CELL) < dist;
}

/** Feldfarbe für eine Stelle im Flachland, sonst null (Flickenteppich aus 60-m-Parzellen). */
export function fieldAt(x: number, z: number, seed: number): number | null {
  const size = 60;
  const ci = Math.floor(x / size);
  const cj = Math.floor(z / size);
  // Einfacher, deterministischer Hash pro Parzelle
  let h = (ci * 374761393 + cj * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  const r = (h >>> 0) / 4294967296;
  if (r < 0.45) return null; // Wiese
  return Math.floor(((r - 0.45) / 0.55) * 4); // 0 … 3: vier Feldarten
}
