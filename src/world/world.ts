import type { Heightfield } from './heightfield';
import { MVP_LAYOUT, type RoadLayout } from './roadLayout';
import { buildRoadNetwork, type RoadNetwork } from './roadNetwork';
import { generateTerrain } from './terrainGen';

export const DEFAULT_SEED = 20261111;

export interface World {
  seed: number;
  terrain: Heightfield;
  roads: RoadNetwork;
  /** Startpunkt: Kante, Position, Richtung. */
  spawn: { edgeId: string; s: number; dir: 1 | -1 };
}

/** Erzeugt Gelände und Wegenetz. Gleicher Seed → gleiche Welt. */
export function createWorld(seed = DEFAULT_SEED, layout: RoadLayout = MVP_LAYOUT): World {
  const terrain = generateTerrain({ seed });
  const roads = buildRoadNetwork(layout, terrain);
  return { seed, terrain, roads, spawn: { edgeId: 'prom-e', s: 5, dir: 1 } };
}
