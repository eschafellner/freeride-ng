import type { Heightfield } from './heightfield';
import { waterLevelAt } from './lakes';
import { clamp, smoothstep } from './random';
import type { LayoutNode, RoadLayout, Surface } from './roadLayout';

/**
 * Wegenetz als Graph: Knoten sind Kreuzungen und Wegenden, Kanten sind Wege
 * mit dicht abgetastetem Verlauf (x, z) und geglättetem Höhenprofil (y).
 */

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  z: number;
  name?: string;
  gate: boolean;
  /** Gebiet (gesperrt bis zur Freischaltung), sonst immer offen. */
  region?: string;
  /** IDs der angeschlossenen Kanten. */
  edges: string[];
}

export class RoadEdge {
  constructor(
    readonly id: string,
    readonly from: string,
    readonly to: string,
    readonly xs: Float64Array,
    readonly ys: Float64Array,
    readonly zs: Float64Array,
    /** Kumulierte Strecke je Punkt in m. */
    readonly ss: Float64Array,
    readonly surface: Surface,
    readonly name?: string,
    /** Gebiet (gesperrt bis zur Freischaltung), sonst immer offen. */
    readonly region?: string,
  ) {}

  get length(): number {
    return this.ss[this.ss.length - 1]!;
  }

  get count(): number {
    return this.xs.length;
  }

  /** Index des Abschnitts, in dem s liegt. */
  private segment(s: number): number {
    const ss = this.ss;
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid]! <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position bei Strecke s (0 … length), linear interpoliert. */
  pointAt(s: number): { x: number; y: number; z: number } {
    const sc = clamp(s, 0, this.length);
    const i = this.segment(sc);
    const t = (sc - this.ss[i]!) / (this.ss[i + 1]! - this.ss[i]! || 1);
    return {
      x: this.xs[i]! + (this.xs[i + 1]! - this.xs[i]!) * t,
      y: this.ys[i]! + (this.ys[i + 1]! - this.ys[i]!) * t,
      z: this.zs[i]! + (this.zs[i + 1]! - this.zs[i]!) * t,
    };
  }

  heightAt(s: number): number {
    return this.pointAt(s).y;
  }

  /** Richtungsvektor (x, z) in Laufrichtung from → to, normiert. */
  directionAt(s: number): { dx: number; dz: number } {
    const a = this.pointAt(s - 2);
    const b = this.pointAt(s + 2);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
  }

  /** Steigung in Richtung from → to, über ±window/2 gemittelt. */
  gradeAt(s: number, window = 20): number {
    const s0 = clamp(s - window / 2, 0, this.length);
    const s1 = clamp(s + window / 2, 0, this.length);
    if (s1 - s0 < 1e-6) return 0;
    return (this.heightAt(s1) - this.heightAt(s0)) / (s1 - s0);
  }
}

export interface NetworkOptions {
  /** Abtastabstand entlang der Wege in m. */
  spacing?: number;
  /** Höchste erlaubte Steigung (0.1 = 10 %). */
  maxGrade?: number;
  /** Glättungsfenster für das Höhenprofil in m. */
  smoothWindow?: number;
  /** Mindesthöhe über dem Meer in m (bis es Brücken gibt). */
  minHeight?: number;
  /** Bis zu diesem Abstand wird das Gelände voll auf Weghöhe gebracht. */
  carveInner?: number;
  /** Bis hierhin wird ins Gelände übergeblendet. */
  carveOuter?: number;
}

const DEFAULTS: Required<NetworkOptions> = {
  spacing: 2,
  maxGrade: 0.1,
  smoothWindow: 60,
  minHeight: 2,
  carveInner: 11,
  carveOuter: 32,
};

/** Fahrbahnhöhe an den Brückenenden mindestens (m über dem Meer). */
export const BRIDGE_MIN_HEIGHT = 9;
/** Fahrbahn an den Enden einer Seebrücke mindestens so hoch über dem Seespiegel (m). */
export const LAKE_BRIDGE_CLEARANCE = 3.5;
/** Zusätzliche Höhe in der Brückenmitte (m). */
const BRIDGE_ARCH = 2;

export class RoadNetwork {
  readonly nodes = new Map<string, RoadNode>();
  readonly edges = new Map<string, RoadEdge>();
  /**
   * Wie stark jede Geländezelle von einem Weg beansprucht ist (0 … 1),
   * gleiches Raster wie die Höhenkarte. Für die Platzierung von Bäumen und Häusern.
   */
  roadMask: Float32Array = new Float32Array(0);
  /** Gesperrte Gebiete: deren Wege sind für den Fahrer nicht befahrbar. */
  readonly lockedRegions = new Set<string>();

  /** Ist der Weg befahrbar (kein gesperrtes Gebiet)? */
  isOpen(edge: RoadEdge): boolean {
    return edge.region === undefined || !this.lockedRegions.has(edge.region);
  }

  get totalLength(): number {
    let sum = 0;
    for (const e of this.edges.values()) sum += e.length;
    return sum;
  }

  node(id: string): RoadNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unbekannter Knoten ${id}`);
    return n;
  }

  edge(id: string): RoadEdge {
    const e = this.edges.get(id);
    if (!e) throw new Error(`Unbekannte Kante ${id}`);
    return e;
  }

  /** Maske an einer Weltposition (nächste Zelle). */
  maskAt(terrain: Heightfield, x: number, z: number): number {
    const i = Math.round((x + terrain.half) / terrain.cell);
    const j = Math.round((z + terrain.half) / terrain.cell);
    if (i < 0 || j < 0 || i >= terrain.res || j >= terrain.res) return 0;
    return this.roadMask[j * terrain.res + i]!;
  }
}

// --- Aufbau -------------------------------------------------------------------

/** Catmull-Rom-Spline durch die Punkte, danach nach Bogenlänge neu abgetastet. */
export function splinePath(points: [number, number][], spacing: number): [number, number][] {
  if (points.length < 2) throw new Error('Mindestens zwei Punkte nötig');
  const p = [points[0]!, ...points, points[points.length - 1]!];
  const dense: [number, number][] = [];
  const STEPS = 24;
  for (let k = 1; k < p.length - 2; k++) {
    const [p0, p1, p2, p3] = [p[k - 1]!, p[k]!, p[k + 1]!, p[k + 2]!];
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(points[points.length - 1]!);

  // Bogenlänge
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]));
  }
  const total = cum[cum.length - 1]!;
  const n = Math.max(1, Math.round(total / spacing));
  const out: [number, number][] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (k < cum.length - 2 && cum[k + 1]! < s) k++;
    const seg = cum[k + 1]! - cum[k]! || 1;
    const t = (s - cum[k]!) / seg;
    const a = dense[k]!;
    const b = dense[k + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Gleitender Mittelwert; die Endpunkte bleiben fest. */
function smoothProfile(h: Float64Array, radius: number): Float64Array {
  const n = h.length;
  if (n < 3 || radius < 1) return h;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + h[i]!;
  const out = new Float64Array(n);
  out[0] = h[0]!;
  out[n - 1] = h[n - 1]!;
  for (let i = 1; i < n - 1; i++) {
    const r = Math.min(radius, i, n - 1 - i);
    out[i] = (prefix[i + r + 1]! - prefix[i - r]!) / (2 * r + 1);
  }
  return out;
}

/**
 * Begrenzt die Steigung bei festen Endpunkten (Einschnitte und Dämme).
 * Jeder Punkt wird zuerst in den „Kegel“ geklemmt, der von beiden Enden aus mit
 * maxGrade erreichbar ist; danach sorgt ein Vorwärtsdurchlauf für die Nachbarpaare.
 * Voraussetzung: |h[n−1] − h[0]| ≤ maxGrade · Länge (siehe relaxNodeHeights).
 */
function limitGrade(h: Float64Array, ss: Float64Array, maxGrade: number): void {
  const n = h.length;
  const h0 = h[0]!;
  const h1 = h[n - 1]!;
  const len = ss[n - 1]!;
  for (let i = 1; i < n - 1; i++) {
    const s = ss[i]!;
    const upper = Math.min(h0 + maxGrade * s, h1 + maxGrade * (len - s));
    const lower = Math.max(h0 - maxGrade * s, h1 - maxGrade * (len - s));
    h[i] = clamp(h[i]!, lower, upper);
  }
  for (let i = 1; i < n - 1; i++) {
    const d = maxGrade * (ss[i]! - ss[i - 1]!);
    h[i] = clamp(h[i]!, h[i - 1]! - d, h[i - 1]! + d);
  }
}

/**
 * Gleicht Knotenhöhen an, bis jede Kante mit höchstens `share` × maxGrade
 * im Mittel machbar ist. Das Gelände wird später passend eingeschnitten.
 */
function relaxNodeHeights(
  nodes: Map<string, RoadNode>,
  edges: { from: string; to: string; length: number }[],
  maxGrade: number,
  minHeight: number,
  share = 0.8,
): void {
  for (let iter = 0; iter < 200; iter++) {
    let worst = 0;
    for (const e of edges) {
      const a = nodes.get(e.from)!;
      const b = nodes.get(e.to)!;
      const allowed = share * maxGrade * e.length;
      const diff = b.y - a.y;
      const excess = Math.abs(diff) - allowed;
      if (excess <= 1e-6) continue;
      worst = Math.max(worst, excess);
      const shift = (excess / 2) * Math.sign(diff);
      a.y += shift;
      b.y = Math.max(minHeight, b.y - shift);
    }
    if (worst < 0.01) return;
  }
}

function nodeHeight(terrain: Heightfield, n: LayoutNode, minHeight: number): number {
  // Mittel über einen kleinen Kreis, damit Kreuzungen nicht auf Spitzen liegen
  let sum = 0;
  let count = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    sum += terrain.sample(n.x + Math.cos(ang) * 15, n.z + Math.sin(ang) * 15);
    count++;
  }
  sum += terrain.sample(n.x, n.z) * 2;
  return Math.max(minHeight, sum / (count + 2));
}

/**
 * Baut das Wegenetz auf dem Gelände und schneidet die Wege ins Gelände ein.
 * Achtung: verändert `terrain`.
 */
export function buildRoadNetwork(
  layout: RoadLayout,
  terrain: Heightfield,
  options: NetworkOptions = {},
): RoadNetwork {
  const o = { ...DEFAULTS, ...options };
  const net = new RoadNetwork();

  for (const n of layout.nodes) {
    if (net.nodes.has(n.id)) throw new Error(`Doppelter Knoten ${n.id}`);
    net.nodes.set(n.id, {
      id: n.id, x: n.x, z: n.z, y: nodeHeight(terrain, n, o.minHeight),
      name: n.name, gate: n.gate ?? false, region: n.region, edges: [],
    });
  }
  // Brücken: Ufer etwas anheben, damit die Fahrbahn deutlich über dem Wasser liegt
  // (über dem Meer höher als über einem See, dort fahren keine Boote mit Mast)
  for (const e of layout.edges) {
    if (e.surface !== 'bridge') continue;
    const a = net.nodes.get(e.from);
    const b = net.nodes.get(e.to);
    if (!a || !b) continue;
    const pts: [number, number][] = [[a.x, a.z], ...(e.via ?? []), [b.x, b.z], [(a.x + b.x) / 2, (a.z + b.z) / 2]];
    const water = Math.max(...pts.map(([x, z]) => waterLevelAt(x, z)));
    const min = water > 0 ? water + LAKE_BRIDGE_CLEARANCE : BRIDGE_MIN_HEIGHT;
    for (const n of [a, b]) n.y = Math.max(n.y, min);
  }

  const smoothRadius = Math.max(1, Math.round(o.smoothWindow / o.spacing / 2));

  // 1. Verlauf abtasten und Geländeprofil lesen
  const sampled = layout.edges.map((e) => {
    if (!net.nodes.has(e.from) || !net.nodes.has(e.to)) {
      throw new Error(`Kante ${e.id} verweist auf unbekannten Knoten`);
    }
    const a = net.node(e.from);
    const b = net.node(e.to);
    const pts = splinePath([[a.x, a.z], ...(e.via ?? []), [b.x, b.z]], o.spacing);
    const n = pts.length;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    const ss = new Float64Array(n);
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = pts[i]![0];
      zs[i] = pts[i]![1];
      if (i > 0) ss[i] = ss[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!);
      h[i] = Math.max(o.minHeight, terrain.sample(xs[i]!, zs[i]!));
    }
    return { layout: e, xs, zs, ss, h, from: e.from, to: e.to, length: ss[n - 1]! };
  });

  // 2. Knotenhöhen so angleichen, dass jede Kante machbar ist
  relaxNodeHeights(net.nodes, sampled, o.maxGrade, o.minHeight);

  // 3. Profil: glätten, Enden auf Knotenhöhe ziehen, Steigung begrenzen, nachglätten
  for (const { layout: e, xs, zs, ss, h: raw, length: len } of sampled) {
    if (net.edges.has(e.id)) throw new Error(`Doppelte Kante ${e.id}`);
    const a = net.node(e.from);
    const b = net.node(e.to);
    const n = xs.length;
    if (e.surface === 'bridge') {
      // Gerade von Ufer zu Ufer mit leichtem Bogen in der Mitte, kein Gelände darunter
      const h = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t = len > 0 ? ss[i]! / len : 0;
        h[i] = a.y + (b.y - a.y) * t + BRIDGE_ARCH * Math.sin(Math.PI * t);
      }
      net.edges.set(e.id, new RoadEdge(e.id, e.from, e.to, xs, h, zs, ss, 'bridge', e.name, e.region));
      a.edges.push(e.id);
      b.edges.push(e.id);
      continue;
    }
    const h = smoothProfile(raw, smoothRadius);
    const d0 = a.y - h[0]!;
    const d1 = b.y - h[n - 1]!;
    for (let i = 0; i < n; i++) {
      const t = len > 0 ? ss[i]! / len : 0;
      h[i] = h[i]! + d0 * (1 - t) + d1 * t;
    }
    h[0] = a.y;
    h[n - 1] = b.y;
    limitGrade(h, ss, o.maxGrade);
    const smooth = smoothProfile(h, Math.max(1, smoothRadius >> 1));
    limitGrade(smooth, ss, o.maxGrade);

    net.edges.set(e.id, new RoadEdge(e.id, e.from, e.to, xs, smooth, zs, ss, e.surface ?? 'asphalt', e.name, e.region));
    a.edges.push(e.id);
    b.edges.push(e.id);
  }

  net.roadMask = carveTerrain(net, terrain, o.carveInner, o.carveOuter);
  return net;
}

/**
 * Bringt das Gelände entlang der Wege auf Weghöhe und blendet nach außen über.
 * @returns Maske je Gitterzelle (0 … 1)
 */
function carveTerrain(net: RoadNetwork, terrain: Heightfield, inner: number, outer: number): Float32Array {
  const res = terrain.res;
  const weight = new Float32Array(res * res);
  const target = new Float32Array(res * res);
  const bestDist = new Float32Array(res * res).fill(Infinity);
  // Obergrenze nahe der Fahrbahn: In engen Kehren liegen zwei Äste mit verschiedener
  // Höhe dicht beieinander. Ohne Grenze stäche das Gelände (10-m-Raster) durch den
  // tieferen Ast, darum zählt dort die niedrigste Fahrbahn in der Nähe.
  const cap = new Float32Array(res * res).fill(Infinity);
  const capDist = Math.min(inner, 9);
  const cells = Math.ceil(outer / terrain.cell);

  const stamp = (x: number, y: number, z: number) => {
    const ci = Math.round((x + terrain.half) / terrain.cell);
    const cj = Math.round((z + terrain.half) / terrain.cell);
    for (let j = cj - cells; j <= cj + cells; j++) {
      if (j < 0 || j >= res) continue;
      for (let i = ci - cells; i <= ci + cells; i++) {
        if (i < 0 || i >= res) continue;
        const d = Math.hypot(terrain.worldX(i) - x, terrain.worldZ(j) - z);
        if (d > outer) continue;
        const k = j * res + i;
        if (d <= capDist && y < cap[k]!) cap[k] = y;
        // Die nächstgelegene Wegstelle bestimmt die Zielhöhe
        if (d < bestDist[k]!) {
          bestDist[k] = d;
          target[k] = y;
          weight[k] = 1 - smoothstep(inner, outer, d);
        }
      }
    }
  };

  for (const e of net.edges.values()) {
    if (e.surface === 'bridge') continue; // unter Brücken bleibt Wasser
    for (let i = 0; i < e.count; i++) stamp(e.xs[i]!, e.ys[i]!, e.zs[i]!);
  }
  for (const n of net.nodes.values()) stamp(n.x, n.y, n.z);

  for (let k = 0; k < weight.length; k++) {
    const w = weight[k]!;
    if (w > 0) terrain.data[k] = Math.min(cap[k]!, terrain.data[k]! + (target[k]! - terrain.data[k]!) * w);
  }
  return weight;
}
