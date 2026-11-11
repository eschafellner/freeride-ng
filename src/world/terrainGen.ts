import { createNoise2D } from 'simplex-noise';
import { Heightfield } from './heightfield';
import { lerp, mulberry32, smoothstep } from './random';

/**
 * Prozedurales Gelände für den MVP-Ausschnitt von Velara:
 * Hafenstadt Lumen an der Südküste, Rebland im Südwesten, Kapellenhügel,
 * nach Norden ansteigend Richtung Hoher Kogel (siehe docs/welt.md).
 *
 * Gezielt nachbessern: Die Formen unten (Küste, Hügel, Stadtfläche) sind
 * bewusst als benannte Bausteine geschrieben.
 */

export const MVP_SIZE_M = 3000;
/** 301 Punkte → 10 m Raster. */
export const MVP_RES = 301;
export const SEA_LEVEL = 0;

/** Rechteck der Stadtfläche Lumen (weich ausgeblendet). */
export const TOWN = { x0: -350, x1: 1150, z0: 330, z1: 980, fade: 150 };

export interface TerrainOptions {
  seed: number;
  size?: number;
  res?: number;
}

const gauss = (x: number, z: number, cx: number, cz: number, r: number) =>
  Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));

export function townMask(x: number, z: number): number {
  const { x0, x1, z0, z1, fade } = TOWN;
  const mx = smoothstep(x0 - fade, x0, x) * (1 - smoothstep(x1, x1 + fade, x));
  const mz = smoothstep(z0 - fade, z0, z) * (1 - smoothstep(z1, z1 + fade, z));
  return mx * mz;
}

export function generateTerrain({ seed, size = MVP_SIZE_M, res = MVP_RES }: TerrainOptions): Heightfield {
  const rng = mulberry32(seed);
  const hillNoise = createNoise2D(rng);
  const coastNoise = createNoise2D(rng);
  const detailNoise = createNoise2D(rng);

  const fbm = (x: number, z: number, octaves: number) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * hillNoise(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  const hf = new Heightfield(size, res);
  for (let j = 0; j < res; j++) {
    const z = hf.worldZ(j);
    for (let i = 0; i < res; i++) {
      const x = hf.worldX(i);

      // Küstenlinie im Süden, leicht gewellt; d = Abstand landeinwärts
      const coastZ = 1030 + 45 * coastNoise(x / 600, 0.37);
      const d = coastZ - z;

      // Großform: steigt nach Norden zum Kogel hin an
      const inland = smoothstep(-100, 2300, d);
      let h = 6 + 160 * inland ** 1.5;

      // Hügel (mehr im Landesinneren)
      h += 30 * fbm(x / 1100, z / 1100, 4) * smoothstep(150, 700, d);
      // Rebland: breite Hügelzone im Südwesten
      h += 45 * gauss(x, z, -850, 80, 600);
      // Kapellenhügel
      h += 55 * gauss(x, z, -620, -640, 300);
      // feine Unebenheiten
      h += 2.5 * detailNoise(x / 90, z / 90);

      // Stadtfläche: sanft ansteigend vom Hafen landeinwärts
      const town = 4 + Math.max(0, 980 - z) * 0.022;
      h = lerp(h, town, townMask(x, z));

      // Meer
      h = lerp(h, SEA_LEVEL - 10, smoothstep(40, -80, d));

      hf.set(i, j, h);
    }
  }
  return hf;
}
