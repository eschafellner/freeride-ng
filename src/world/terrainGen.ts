import { createNoise2D } from 'simplex-noise';
import { Heightfield } from './heightfield';
import { lakeBasinHeight, lakeBasinWeight, nearestLake } from './lakes';
import { clamp, lerp, mulberry32, smoothstep } from './random';

/**
 * Prozedurales Gelände für den MVP-Ausschnitt von Velara:
 * Hafenstadt Lumen an der Südküste, Rebland im Südwesten, Kapellenhügel,
 * nach Norden ansteigend Richtung Hoher Kogel (siehe docs/welt.md).
 *
 * Gezielt nachbessern: Die Formen unten (Küste, Hügel, Stadtfläche) sind
 * bewusst als benannte Bausteine geschrieben.
 */

/**
 * Kantenlänge der Welt in m. Lumen und Rebland liegen im Bereich ±1500 m, die
 * Glutsteppe östlich davon, der Hohe Kogel und das Nordkap im Norden. Das 10-m-Raster
 * bleibt, damit sich bestehende Gebiete beim Vergrößern nicht verändern.
 */
export const MVP_SIZE_M = 7200;
/** 721 Punkte → 10 m Raster. */
export const MVP_RES = 721;
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

// --- Glutsteppe (Osten, hinter der Hafenbrücke) --------------------------------------

/** Mittellinie der Bucht zwischen Lumen und Glutsteppe (Hafenbrücke führt darüber). */
export const BAY = { x: 1480, halfWidth: 95, head: 640 };

/** Verlauf der Schlucht „Rotklamm“ (von der Bucht nach Norden), gleiche Punkte wie der Weg. */
export const CANYON: [number, number][] = [
  [1480, 700], [1530, 420], [1560, 200], [1500, -50], [1580, -300], [1640, -480], [1680, -640], [1700, -820],
];

/** Tafelberge: Mitte, Radius der Fläche oben, Höhe über dem Umland. */
export const MESAS = [
  { x: 2190, z: 60, r: 80, h: 55 },
  { x: 1760, z: -170, r: 60, h: 42 },
  { x: 2230, z: -420, r: 55, h: 48 },
  { x: 1980, z: 470, r: 45, h: 28 },
  { x: 1860, z: -1030, r: 70, h: 60 },
] as const;

// --- Hoher Kogel (Norden, hinter dem Passweg) ----------------------------------------

/**
 * Der Berg: Gipfel, Höhe über der Hochfläche, Radius des Fußes. Die Flanken sind
 * fast gleichmäßig steil (gut für Kehren), Gipfel und Fuß sind abgerundet. Nach Süden
 * läuft der Fuß vor dem Passweg aus, damit Rebland und Passstraße unverändert bleiben.
 */
export const KOGEL = { x: 0, z: -2300, h: 525, foot: 1080, round: 0.25, southEnd: -1330 } as const;

/** Nordküste (z-Wert der Küstenlinie, leicht gewellt) westlich und östlich des Nordkaps. */
export const NORTH_COAST_Z = -2880;

// --- Nordkap (Nordküste, hinter Obersee und Glutplateau) -----------------------------

/**
 * Nordkap: Die Küste wölbt sich zwischen Obersee und Ostküste weit nach Norden. Die
 * Hochfläche läuft weiter bis an hohe Klippen, an drei Buchten liegt unten ein Strand,
 * und das Kap mit dem Leuchtturm ragt am weitesten hinaus. `bulge` ist die Ausbuchtung
 * gegenüber `NORTH_COAST_Z`, `drop` wie viel tiefer die Klippenkante als die Hochfläche liegt.
 */
export const NORDKAP = { x0: -1500, x1: -900, x2: 1650, x3: 2250, bulge: 420, drop: 22 } as const;

/** Das Kap mit dem Leuchtturm: ragt `reach` m über die Küste hinaus. */
export const CAPE = { x: 380, width: 105, reach: 150 } as const;

/** Buchten am Nordkap: Mitte der Küstenlinie (x), Tiefe ins Land und Breite in m. */
export const COVES = [
  { id: 'moewenbucht', x: -1020, depth: 120, width: 80 },
  { id: 'kapbucht', x: 860, depth: 110, width: 85 },
  { id: 'robbenbucht', x: 1560, depth: 120, width: 80 },
] as const;

/** Anteil der Ausbuchtung an einer Stelle x (0 … 1). */
function nordkapSpan(x: number): number {
  return smoothstep(NORDKAP.x0, NORDKAP.x1, x) * (1 - smoothstep(NORDKAP.x2, NORDKAP.x3, x));
}

/** Küstenlinie im Norden ohne Wellung (z, kleiner = weiter im Norden). */
export function northCoastZ(x: number): number {
  let z = NORTH_COAST_Z - NORDKAP.bulge * nordkapSpan(x);
  z -= CAPE.reach * Math.exp(-(((x - CAPE.x) / CAPE.width) ** 2));
  for (const c of COVES) z += c.depth * Math.exp(-(((x - c.x) / c.width) ** 2));
  return z;
}

/** Strand am Ende einer Bucht (Mitte). */
export function coveBeach(c: (typeof COVES)[number]): [number, number] {
  return [c.x, northCoastZ(c.x) + 25];
}

/**
 * 1 am Nordkap, 0 außerhalb. Das Nordkap ist das neue Land nördlich der alten Küste
 * (`NORTH_COAST_Z`): Südlich davon bleibt das Gelände unverändert, damit Kogel und
 * Obersee bleiben, wie sie sind. `oldNorthD` ist der Abstand zur alten Küste (gewellt).
 */
export function nordkapMask(x: number, z: number, oldNorthD = z - NORTH_COAST_Z): number {
  return nordkapSpan(x) * smoothstep(45, -200, oldNorthD);
}

/**
 * Änderung der Hochfläche am Nordkap: zur Küste hin etwas tiefer, sanfte Wellen für die
 * Küstenstraße. Die Buchten setzt `generateTerrain` danach ein.
 */
function nordkapRelief(x: number, z: number, oldNorthD: number, noise: (x: number, z: number) => number): number {
  return -NORDKAP.drop * smoothstep(0, -450, oldNorthD) + 9 * noise(x / 520 + 4.1, z / 520 - 1.7);
}

/** Strand in einer Bucht: flacher Grund (≈ 2 m) mit steilen Wänden, 0 … 1 Anteil. */
function coveWeight(x: number, z: number): number {
  let w = 0;
  for (const c of COVES) {
    const [bx, bz] = coveBeach(c);
    const d = Math.hypot((x - bx) * 0.85, z - bz);
    w = Math.max(w, 1 - smoothstep(40, 95, d));
  }
  return w;
}

/**
 * Höhenprofil des Kogels über dem Abstand (0 … 1 des Fußradius): 1 am Gipfel, 0 am Fuß.
 * Gleichmäßige Neigung, oben und unten auf `round` des Radius weich gerundet.
 */
export function kogelProfile(t: number): number {
  const a = KOGEL.round;
  const tt = clamp(t, 0, 1);
  let g: number;
  if (tt < a) g = (tt * tt) / (2 * a);
  else if (tt > 1 - a) g = 1 - a - (1 - tt) ** 2 / (2 * a);
  else g = a / 2 + (tt - a);
  return 1 - g / (1 - a);
}

/** Anteil des Bergs an einem Punkt (0 … 1, 1 am Gipfel), ohne Rippen. */
export function kogelMask(x: number, z: number): number {
  const d = Math.hypot(x - KOGEL.x, z - KOGEL.z);
  return kogelProfile(d / KOGEL.foot) * smoothstep(KOGEL.southEnd, KOGEL.southEnd - 380, z);
}

/** Zusätzliche Höhe des Kogels: gleichmäßige Flanken, Rippen und Rinnen. */
function kogelHeight(x: number, z: number, noise: (x: number, z: number) => number): number {
  const dx = x - KOGEL.x;
  const dz = z - KOGEL.z;
  const d = Math.hypot(dx, dz);
  if (d > KOGEL.foot * 1.15) return 0;
  const fade = smoothstep(KOGEL.southEnd, KOGEL.southEnd - 380, z);
  if (fade <= 0) return 0;
  // Rippen und Rinnen strahlenförmig vom Gipfel weg
  const ang = Math.atan2(dz, dx);
  const wobble = 1 + 0.05 * noise(Math.cos(ang) * 1.4, Math.sin(ang) * 1.4) + 0.025 * Math.sin(ang * 7);
  const p = kogelProfile((d * wobble) / KOGEL.foot);
  const crag = 10 * noise(x / 140, z / 140) * Math.min(p, 1 - p) * 2;
  return (KOGEL.h * p + crag) * fade;
}

// --- Spiegelseen (Nordwesten, hinter dem Forsthaus) ---------------------------------

/** Gebiet der Spiegelseen (weich ausgeblendet), Seen in `lakes.ts`. */
export const SEENLAND = { x0: -2800, x1: -1250, z0: -2800, z1: -860, fade: 220 } as const;

/** 1 im Seengebiet, 0 außerhalb. */
export function seenMask(x: number, z: number): number {
  const { x0, x1, z0, z1, fade } = SEENLAND;
  const mx = smoothstep(x0 - fade, x0, x) * (1 - smoothstep(x1, x1 + fade, x));
  const mz = smoothstep(z0 - fade, z0, z) * (1 - smoothstep(z1, z1 + fade, z));
  return mx * mz;
}

/**
 * Westküste: bei Rebland wie bisher, im Norden weiter draußen, damit Platz für die
 * Seen bleibt (ohne Wellung).
 */
export function westCoastX(z: number): number {
  return -1760 - 960 * smoothstep(-380, -1100, z);
}

/** 1 in der Glutsteppe, 0 westlich der Bucht. */
export function steppeMask(x: number, z: number): number {
  // An der Bucht beginnt die Steppe am Ostufer, nördlich davon schon vor der Schlucht
  const edge = lerp(1530, 1390, smoothstep(700, 450, z));
  return smoothstep(edge - 110, edge + 110, x) * (1 - smoothstep(-1300, -1700, z));
}

/** Abstand eines Punktes zu einem Linienzug. */
export function distanceToPolyline(x: number, z: number, line: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k]!;
    const [bx, bz] = line[k + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Wasser in der Bucht (0 … 1). */
function bayMask(x: number, z: number, wobble: number): number {
  const across = 1 - smoothstep(BAY.halfWidth - 45, BAY.halfWidth + 55, Math.abs(x - BAY.x - wobble));
  return across * smoothstep(BAY.head - 60, BAY.head + 60, z);
}

/** Höhe der Glutsteppe: Hochfläche nach Norden ansteigend, Tafelberge, Schlucht. */
function steppeHeight(x: number, z: number, noise: (x: number, z: number) => number): number {
  let h = 12 + 150 * smoothstep(950, -1300, z) ** 1.2;
  // flache Wellen und einzelne Kuppen
  h += 14 * noise(x / 700, z / 700) + 5 * noise(x / 160, z / 160);
  // Tafelberge mit steilen Flanken und flacher Kuppe
  for (const m of MESAS) {
    const d = Math.hypot(x - m.x, z - m.z) + 12 * noise(x / 60, z / 60);
    h += m.h * (1 - smoothstep(m.r, m.r + 35, d));
  }
  // Rotklamm: flacher Grund, steile Wände
  const dc = distanceToPolyline(x, z, CANYON);
  const depth = 42 * smoothstep(650, 350, z) ** 0.5;
  const carved = h - depth * (1 - smoothstep(28, 70, dc));
  // Der Grund bleibt über dem Meer (sonst stünde Wasser in der Schlucht)
  return Math.max(carved, Math.min(h, 5));
}

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

      // Glutsteppe im Osten
      const steppe = steppeMask(x, z);
      if (steppe > 0) h = lerp(h, steppeHeight(x, z, detailNoise), steppe);

      // Nordkap: Küstenstreifen mit Klippen und Buchten nördlich der alten Küste
      const oldNorthD = z - (NORTH_COAST_Z + 55 * coastNoise(x / 520, 0.61));
      const kap = nordkapMask(x, z, oldNorthD);
      if (kap > 0) {
        h += nordkapRelief(x, z, oldNorthD, detailNoise) * kap;
        // Buchten voll einschneiden, auch wo die Ausbuchtung noch nicht ganz erreicht ist
        h = lerp(h, 2 + 0.8 * detailNoise(x / 40, z / 40), coveWeight(x, z) * smoothstep(45, -200, oldNorthD));
      }

      // Hoher Kogel im Norden
      h += kogelHeight(x, z, coastNoise);

      // Spiegelseen: sanfte Waldhochfläche, nach Norden leicht ansteigend, mit Seebecken.
      // Zum Ufer hin werden die Kuppen flacher, damit kein Wall um die Seen entsteht.
      const seen = seenMask(x, z);
      if (seen > 0) {
        const { lake, e } = nearestLake(x, z);
        const knolls = 9 * fbm(x / 650 + 7.3, z / 650 - 2.1, 2) * smoothstep(1.3, 2.6, e);
        const plateau = 160 + 20 * smoothstep(-900, -2600, z) + knolls + 0.6 * detailNoise(x / 60, z / 60);
        h = lerp(h, plateau, seen);
        if (lake) h = lerp(h, lakeBasinHeight(lake, e), lakeBasinWeight(e) * seen);
      }

      // Meer: Südküste, dazu West- und Ostküste der Insel und die Bucht vor der Glutsteppe
      const westD = x - (westCoastX(z) + 60 * coastNoise(0.81, z / 500));
      const eastD = 2260 + 70 * coastNoise(0.23, z / 450) - x;
      // Am Nordkap ist die Küste weniger gewellt, die Buchten geben die Form vor
      const northD = z - (northCoastZ(x) + 55 * (1 - 0.6 * nordkapSpan(x)) * coastNoise(x / 520, 0.61));
      // Im Nordwesten fällt die Hochfläche über einen breiten Steilhang zum Meer ab
      if (seen > 0) h -= Math.max(0, h - 30) * (1 - smoothstep(0, 210, westD)) ** 1.4 * seen;
      const coast = Math.min(d, westD, eastD, northD);
      // Am Nordkap fallen Klippen steil ins Meer, in den Buchten liegt ein flacher Strand
      const cliff = nordkapSpan(x) * (northD < Math.min(d, westD, eastD) ? 1 : 0);
      h = lerp(h, SEA_LEVEL - 10, lerp(smoothstep(40, -80, coast), smoothstep(14, -26, coast), cliff));
      h = lerp(h, SEA_LEVEL - 9, bayMask(x, z, 18 * coastNoise(0.5, z / 300)));

      hf.set(i, j, h);
    }
  }
  return hf;
}
