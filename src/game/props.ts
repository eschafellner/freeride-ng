import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad, REBLAND } from '../world/placement';
import { mulberry32, smoothstep } from '../world/random';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadEdge, RoadNetwork } from '../world/roadNetwork';
import { kogelMask, steppeMask, townMask } from '../world/terrainGen';
import { SCREE_LINE, TREELINE } from './terrainMesh';
import { merged, painted } from './details';

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
import { createFrontPaths, createHouseVariants, part, sharedHouseMaterial, SURF, TOWNHOUSE_DEPTH, TOWNHOUSE_WIDTHS, type FrontPath } from './houses';
import { PLAZAS } from './shaderChunks';
import { createShopFronts, type ShopPlacement } from './shopFronts';
import { DynamicLod, lod, LodInstances } from './lod';
import { assignShops, hasTerrace, type ShopSlot } from '../world/shops';
import { REGIONS } from '../world/roadLayout';

// --- Modelle (eigene Low-Poly-Entwürfe) ---------------------------------------------

function conifer(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0), '#7a5a3a'),
    painted(new THREE.ConeGeometry(2.2, 4, 6).translate(0, 3.6, 0), '#3f7a34'),
    painted(new THREE.ConeGeometry(1.6, 3, 6).translate(0, 5.6, 0), '#4a8a3a'),
  ]);
}

function deciduous(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 5).translate(0, 1.3, 0), '#6e5235'),
    painted(new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.0, 0), '#6fa83e'),
    painted(new THREE.IcosahedronGeometry(1.6, 0).translate(0.9, 5.0, 0.4), '#7db648'),
  ]);
}

/** Fernmodelle: ein Kegel bzw. eine Krone, ohne Stamm (rund ein Viertel der Dreiecke). */
function coniferFar(): THREE.BufferGeometry {
  return painted(new THREE.ConeGeometry(2.1, 6.4, 5, 1, true).translate(0, 4.4, 0), '#437e36');
}

function deciduousFar(): THREE.BufferGeometry {
  return painted(new THREE.IcosahedronGeometry(2.5, 0).translate(0, 4.2, 0), '#72aa41');
}

function bush(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.IcosahedronGeometry(0.9, 0).scale(1.3, 0.8, 1.1).translate(0, 0.55, 0), '#5c9a3a'),
    painted(new THREE.IcosahedronGeometry(0.6, 0).translate(0.7, 0.5, 0.3), '#68a843'),
  ]);
}

function redRock(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.DodecahedronGeometry(1, 0).scale(1.3, 1.1, 1).translate(0, 0.5, 0), '#a8553a'),
    painted(new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.8, 1).translate(0.9, 0.3, 0.4), '#8a4330'),
  ]);
}

function rock(): THREE.BufferGeometry {
  return painted(new THREE.DodecahedronGeometry(1, 0).scale(1.4, 0.8, 1.1).translate(0, 0.3, 0), '#9a958c');
}

/** Glutsteppe: sonnige, erdige Töne. */
const STEPPE_WALLS = ['#e8c49a', '#f0d6b0', '#d9a77e', '#f2e3c8', '#e4b48c', '#efcf9e'];
const WALL_COLORS = ['#f2e6d0', '#e8d4b0', '#f5efe6', '#e6c9a8', '#d9e2e6', '#f0d9c8', '#e9c3b5'];
const TOWNHOUSE_COLORS = ['#e8b796', '#f0d58c', '#c9d8e0', '#f2e6d0', '#d8b0a0', '#e0e8c8', '#f3c9a0', '#d9c7a7', '#b9cfc0', '#efe0b8', '#e2a990', '#cfd6dc'];

class Occupancy {
  private cells = new Set<string>();
  constructor(private readonly size: number) {}
  /** Belegt die Fläche ohne Prüfung (für reservierte Stellen, die sich überlappen dürfen). */
  take(x: number, z: number, radius = 0): void {
    const r = Math.ceil(radius / this.size);
    const ci = Math.floor(x / this.size);
    const cj = Math.floor(z / this.size);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) this.cells.add(`${i},${j}`);
  }

  /** Ist die Zelle an (x, z) frei? Belegt nichts. */
  free(x: number, z: number): boolean {
    return !this.cells.has(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
  }

  tryTake(x: number, z: number, radius = 0): boolean {
    const r = Math.ceil(radius / this.size);
    const ci = Math.floor(x / this.size);
    const cj = Math.floor(z / this.size);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (this.cells.has(`${i},${j}`)) return false;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) this.cells.add(`${i},${j}`);
    return true;
  }
}

interface Instance {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}


/** Schild an der Schranke: Gebiet und nötiges Level. */
function gateSignTexture(name: string, level: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, 494, 238);
  ctx.fillStyle = '#2b2b2b';
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText(name, 256, 108);
  ctx.font = '40px sans-serif';
  ctx.fillText(`gesperrt bis Level ${level}`, 256, 180);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Gedrehtes Rechteck im Grundriss: Mitte, Richtung der Breite (ax, az), halbe Maße. */
interface Rect {
  x: number;
  z: number;
  ax: number;
  az: number;
  hw: number;
  hd: number;
}

/** Überlappen sich zwei gedrehte Rechtecke? (Trennachsen-Test) */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const r of [a, b]) {
    for (const [ux, uz] of [[r.ax, r.az], [-r.az, r.ax]] as const) {
      const ra = a.hw * Math.abs(a.ax * ux + a.az * uz) + a.hd * Math.abs(-a.az * ux + a.ax * uz);
      const rb = b.hw * Math.abs(b.ax * ux + b.az * uz) + b.hd * Math.abs(-b.az * ux + b.ax * uz);
      if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
    }
  }
  return true;
}

function rectCorners(r: Rect): [number, number][] {
  const bx = -r.az;
  const bz = r.ax;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [
    r.x + r.ax * r.hw * i! + bx * r.hd * j!,
    r.z + r.az * r.hw * i! + bz * r.hd * j!,
  ]);
}

/**
 * Häuser, Bäume, Büsche, Felsen und Schranken.
 * @param reserved Stellen, die frei bleiben sollen (Wahrzeichen), mit Radius
 */
export function createProps(
  terrain: Heightfield,
  roads: RoadNetwork,
  seed: number,
  reserved: { x: number; z: number; r: number }[] = [],
): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(seed ^ 0x1234567);
  const occupied = new Occupancy(6);
  for (const r of reserved) occupied.take(r.x, r.z, r.r);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const mat = (x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(pos.set(x, y, z), q.setFromAxisAngle(up, rot), scale.set(sx, sy, sz));

  // --- Gebäude entlang der Wege ---------------------------------------------------------
  // 1. Bauplätze sammeln, 2. Läden nach Lage zuweisen, 3. Häuser, Läden und Wege bauen
  const variants = createHouseVariants(mulberry32(seed ^ 0x51ed));
  const barns: Instance[] = [];
  const villages = [...roads.nodes.values()].filter((n) => n.name?.endsWith('dorf'));
  /**
   * Meerseite eines Weges: Liegt in Blickrichtung vom Weg weg (dx, dz) innerhalb
   * von 100 m Wasser, bleibt die Seite frei, damit Promenade und Strand offen sind.
   */
  const seaward = (x: number, z: number, dx: number, dz: number) => {
    for (let r = 10; r <= 100; r += 10) if (terrain.sample(x + dx * r, z + dz * r) < 1) return true;
    return false;
  };
  const markt = roads.nodes.get('markt');
  const hafen = roads.nodes.get('hafen');

  interface Building {
    kind: 'house' | 'townhouse' | 'barn';
    x: number;
    y: number;
    z: number;
    rot: number;
    /** Abstand der Gebäudemitte zur Wegmitte und Rand von Gehsteig/Fahrbahn. */
    off: number;
    edgeOff: number;
    toRoad: { x: number; z: number };
    slot: ShopSlot;
    /** Häuserzeile im Ortskern: Breite, Lage am Weg (für Rücksprung und Vorplatz). */
    row?: { width: number; edge: RoadEdge; s: number; side: number; base: { x: number; z: number }; gapAfter: number };
  }
  const buildings: Building[] = [];
  const rects: Rect[] = [];
  const edgeOffOf = (e: RoadEdge) => (e.surface === 'town' ? 5.15 : e.surface === 'gravel' ? 2.4 : 3.2);
  const inPlaza = (r: Rect) =>
    PLAZAS.some((pl) => {
      const n = roads.nodes.get(pl.node);
      if (!n) return false;
      // Abstand Platzmitte → Rechteck
      const dx = n.x - r.x;
      const dz = n.z - r.z;
      const lx = Math.max(0, Math.abs(dx * r.ax + dz * r.az) - r.hw);
      const lz = Math.max(0, Math.abs(-dx * r.az + dz * r.ax) - r.hd);
      return Math.hypot(lx, lz) < pl.radius + 1.5;
    });

  // 1a. Ortskern: geschlossene Häuserzeilen direkt am Gehsteig, Haus an Haus
  for (const e of roads.edges.values()) {
    const edgeOff = edgeOffOf(e);
    for (const side of [1, -1]) {
      let s = 9 + rng() * 2;
      while (s < e.length - 9) {
        const width = pick(rng, TOWNHOUSE_WIDTHS);
        const mid = s + width / 2;
        if (mid + width / 2 > e.length - 9) break;
        const p = e.pointAt(mid);
        const toMarkt = markt ? Math.hypot(p.x - markt.x, p.z - markt.z) : Infinity;
        if (!(townMask(p.x, p.z) > 0.7 && toMarkt < 260)) {
          s += 3;
          continue;
        }
        const d = e.directionAt(mid);
        const nx = -d.dz * side;
        const nz = d.dx * side;
        // Platzbedarf inklusive bis zu 2,3 m Rücksprung für Läden mit Außenbereich
        const span = TOWNHOUSE_DEPTH + 2.3;
        const cOff = edgeOff + 0.9 + span / 2;
        const rect: Rect = { x: p.x + nx * cOff, z: p.z + nz * cOff, ax: d.dx, az: d.dz, hw: width / 2 - 0.25, hd: span / 2 };
        const off = edgeOff + 0.9 + TOWNHOUSE_DEPTH / 2;
        const x = p.x + nx * off;
        const z = p.z + nz * off;
        const y = terrain.sample(x, z);
        const corners = rectCorners(rect);
        const ok =
          y >= 2 && terrain.slope(x, z) <= 0.3 && !seaward(x, z, nx, nz) &&
          [[x, z] as [number, number], ...corners].every(([cx, cz]) => occupied.free(cx, cz)) &&
          corners.every(([cx, cz]) => distanceToRoad(roads, cx, cz, undefined, 30) >= edgeOff + 0.35) &&
          !inPlaza(rect) && !rects.some((r) => rectsOverlap(r, rect));
        if (!ok) {
          s += 1.5;
          continue;
        }
        rects.push(rect);
        buildings.push({
          kind: 'townhouse', x, y, z,
          rot: Math.atan2(-nx, -nz),
          off, edgeOff,
          toRoad: { x: -nx, z: -nz },
          slot: hafen && Math.hypot(x - hafen.x, z - hafen.z) < 170
            ? { x, z, district: 'hafen', town: 'lumen', centerDist: Math.hypot(x - hafen.x, z - hafen.z), barn: false, id: buildings.length }
            : { x, z, district: 'kern', town: 'lumen', centerDist: toMarkt, barn: false, id: buildings.length },
          row: { width, edge: e, s: mid, side, base: { x: p.x, z: p.z }, gapAfter: 0 },
        });
        // Lücken: meist Wand an Wand, manchmal eine Fuge oder ein Durchgang
        const r = rng();
        const gap = r < 0.7 ? 0 : r < 0.9 ? 0.2 + rng() * 0.4 : 3 + rng() * 3;
        buildings[buildings.length - 1]!.row!.gapAfter = gap;
        s += width + gap;
      }
    }
  }
  for (const b of buildings) occupied.take(b.x, b.z, 3);

  // 1b. Übrige Bauplätze: freistehende Häuser in Stadt und Dörfern, Scheunen
  for (const e of roads.edges.values()) {
    for (let s = 12; s < e.length - 12; s += 15) {
      const p = e.pointAt(s);
      const town = townMask(p.x, p.z) > 0.7;
      const toMarkt = markt ? Math.hypot(p.x - markt.x, p.z - markt.z) : Infinity;
      if (town && toMarkt < 260) continue; // Ortskern: siehe oben
      const village = villages.find((v) => Math.hypot(v.x - p.x, v.z - p.z) < 150);
      const rural = !town && !village && Math.hypot(p.x - REBLAND.x, p.z - REBLAND.z) < REBLAND.radius + 200;
      if (!town && !village && !(rural && rng() < 0.035)) continue;
      if (village && rng() < 0.45) continue;
      const d = e.directionAt(s);
      for (const side of [1, -1]) {
        if (rng() < 0.25) continue;
        const kind = rural ? 'barn' : 'house';
        const off = kind === 'barn' ? 18 : 13 + rng() * 3;
        const x = p.x - d.dz * off * side;
        const z = p.z + d.dx * off * side;
        if (distanceToRoad(roads, x, z, undefined, 30) < (kind === 'barn' ? 11 : 8)) continue;
        const y = terrain.sample(x, z);
        if (y < 2 || terrain.slope(x, z) > 0.3 || seaward(x, z, -d.dz * side, d.dx * side)) continue;
        const rect: Rect = kind === 'barn'
          ? { x, z, ax: d.dx, az: d.dz, hw: 7, hd: 5 }
          : { x, z, ax: d.dx, az: d.dz, hw: 4.8, hd: 4.2 };
        if (rects.some((r) => rectsOverlap(r, rect))) continue;
        if (!occupied.tryTake(x, z, kind === 'barn' ? 9 : 5)) continue;
        rects.push(rect);

        // Lage für die Ladenverteilung
        const toHafen = hafen ? Math.hypot(x - hafen.x, z - hafen.z) : Infinity;
        let slot: Omit<ShopSlot, 'id'>;
        if (kind === 'barn') slot = { x, z, district: 'land', town: 'land', centerDist: 0, barn: true };
        else if (village) slot = { x, z, district: 'dorf', town: village.id, centerDist: Math.hypot(x - village.x, z - village.z), barn: false };
        else if (town && toHafen < 170) slot = { x, z, district: 'hafen', town: 'lumen', centerDist: toHafen, barn: false };
        else slot = { x, z, district: 'stadt', town: 'lumen', centerDist: toMarkt, barn: false };

        buildings.push({
          kind, x, y, z,
          // Front (+z) zur Straße
          rot: Math.atan2(d.dz * side, -d.dx * side),
          off,
          edgeOff: edgeOffOf(e),
          toRoad: { x: d.dz * side, z: -d.dx * side },
          slot: { ...slot, id: buildings.length },
        });
      }
    }
  }

  const shopRng = mulberry32(seed ^ 0x5a0b);
  const shopOf = new Map(assignShops(buildings.map((b) => b.slot), shopRng).map((a) => [a.slot, a]));

  const variantLists = [variants.houses, variants.townhouses, variants.houseShops, variants.townhouseShops];
  const instances: Instance[][][] = variantLists.map((l) => l.map(() => []));
  const frontPaths: FrontPath[] = [];
  const gardenBushes: Instance[] = [];
  const shops: ShopPlacement[] = [];
  const footprints: { x: number; z: number }[][] = [];
  const aprons: THREE.BufferGeometry[] = [];
  const doorPoint = new THREE.Vector3();

  for (const b of buildings) {
    const shop = shopOf.get(b.slot.id);
    if (b.kind === 'barn') {
      const sc = 0.9 + rng() * 0.3;
      barns.push({ matrix: mat(b.x, b.y - 0.3, b.z, b.rot, sc) });
      if (shop) {
        shops.push({
          type: shop.type, name: shop.name, x: b.x, y: b.y - 0.3, z: b.z, rot: b.rot, sc, sy: sc,
          front: 4, door: { x: 0, z: 4.6 }, depth: b.off - 4 * sc - b.edgeOff,
        });
      }
      continue;
    }
    const town = b.kind === 'townhouse';
    const listIndex = (town ? 1 : 0) + (shop ? 2 : 0);
    const list = variantLists[listIndex]!;
    // Stadthäuser: nur Varianten mit passender Breite
    const candidates = list.map((v, i) => ({ v, i })).filter(({ v }) => !b.row || v.width === b.row.width);
    const { v: variant, i: vi } = candidates[Math.floor(rng() * candidates.length)]!;
    const sc = town ? 1 : 0.85 + rng() * 0.25;
    const sy = town ? 1 : 0.9 + rng() * 0.15;

    if (b.row) {
      // Läden springen zurück, damit Tische und Aufsteller Platz haben
      const setback = shop ? (hasTerrace(shop.type) ? 2.3 : 0.9) : 0;
      b.off += setback;
      b.x = b.row.base.x - b.toRoad.x * b.off;
      b.z = b.row.base.z - b.toRoad.z * b.off;
      b.y = terrain.sample(b.x, b.z);
    }
    const matrix = mat(b.x, b.y - 0.3, b.z, b.rot, sc, sy, sc);
    const palette = town ? TOWNHOUSE_COLORS : steppeMask(b.x, b.z) > 0.5 ? STEPPE_WALLS : WALL_COLORS;
    instances[listIndex]![vi]!.push({ matrix, color: new THREE.Color(palette[Math.floor(rng() * palette.length)]!) });

    // Grundfläche (für die Grasmaske: kein Gras an den Wänden)
    const hw = variant.width / 2 + 0.4;
    const hd = variant.depth / 2 + 0.4;
    footprints.push([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => {
      doorPoint.set(lx!, 0, lz!).applyMatrix4(matrix);
      return { x: doorPoint.x, z: doorPoint.z };
    }));

    const depth = b.off - variant.front * sc - b.edgeOff;
    if (shop) {
      shops.push({
        type: shop.type, name: shop.name, x: b.x, y: b.y - 0.3, z: b.z, rot: b.rot, sc, sy,
        front: variant.front, window: variant.shop, door: variant.door, depth, halfWidth: variant.width / 2 - 0.4,
      });
    }

    if (b.row) {
      // Gepflasterter Vorplatz zwischen Hausfront und Gehsteig (statt Rasen)
      const { edge, s, side, width, gapAfter } = b.row;
      const zFront = variant.front - 0.05;
      const zRoad = b.off - b.edgeOff + 0.35;
      // In Laufrichtung (+s) liegt lokal −side · x; dort auch die Lücke zum Nachbarn pflastern
      const ahead = width / 2 + 0.3 + gapAfter;
      const lxs = side > 0 ? [-ahead, width / 2 + 0.3] : [-(width / 2 + 0.3), ahead];
      const pts = [[lxs[0]!, zFront], [lxs[1]!, zFront], [lxs[1]!, zRoad], [lxs[0]!, zRoad]].map(([lx, lz]) => {
        doorPoint.set(lx!, 0, lz!).applyMatrix4(mat(b.x, 0, b.z, b.rot, 1));
        // Gehsteighöhe an dieser Stelle: Wegprofil + Fahrbahnanhebung + Bordstein
        const walkY = edge.pointAt(s - side * lx!).y + 0.26;
        return new THREE.Vector3(doorPoint.x, Math.max(walkY, terrain.meshHeight(doorPoint.x, doorPoint.z) + 0.02), doorPoint.z);
      });
      const g = new THREE.BufferGeometry().setFromPoints([pts[0]!, pts[2]!, pts[1]!, pts[0]!, pts[3]!, pts[2]!]);
      g.computeVertexNormals();
      if (g.attributes.normal!.getY(0) < 0) g.setFromPoints([pts[0]!, pts[1]!, pts[2]!, pts[0]!, pts[2]!, pts[3]!]).computeVertexNormals();
      aprons.push(part(g, '#c4bcae', 0, SURF.paving));
      footprints.push(pts.map((q) => ({ x: q.x, z: q.z })));
      continue;
    }

    // Weg von der Tür bis an den Gehsteig bzw. Fahrbahnrand
    doorPoint.set(variant.door.x, 0, variant.door.z).applyMatrix4(matrix);
    const remaining = b.off - variant.door.z * sc - b.edgeOff;
    if (remaining > 1) {
      frontPaths.push({
        from: { x: doorPoint.x, z: doorPoint.z },
        to: { x: doorPoint.x + b.toRoad.x * remaining, z: doorPoint.z + b.toRoad.z * remaining },
      });
    }
    // Büsche an einer oder beiden vorderen Hausecken (nicht vor Läden mit Außenbereich)
    for (const corner of [-1, 1]) {
      if (rng() < (shop ? 0.85 : 0.45)) continue;
      const cx = (corner * 4.6 + (rng() - 0.5)) * sc;
      const cz = 3.9 * sc + rng() * 0.6;
      doorPoint.set(cx, 0, cz).applyMatrix4(matrix);
      gardenBushes.push({ matrix: mat(doorPoint.x, terrain.sample(doorPoint.x, doorPoint.z) - 0.1, doorPoint.z, rng() * 6, 0.45 + rng() * 0.3) });
    }
  }

  // Häuser und Scheunen in Kacheln: Detailmodell bis 130 m, danach das Fernmodell
  const houseMat = sharedHouseMaterial();
  variantLists.forEach((list, li) => list.forEach((v, vi) => {
    const items = instances[li]![vi]!;
    if (items.length === 0) return;
    group.add(lod.add(new DynamicLod({
      name: `haus${li}-${vi}`, near: v.geometry, far: v.far, material: houseMat,
      nearDist: 130, hideDist: 3000, castShadow: true, farShadow: false,
    }, items)).group);
  }));
  if (barns.length > 0) {
    group.add(lod.add(new LodInstances({
      name: 'scheune', near: variants.barn, material: houseMat, nearDist: 3000, hideDist: 3000, castShadow: true, cell: 300,
    }, barns)).group);
  }
  if (aprons.length > 0) {
    const apronMesh = new THREE.Mesh(mergeGeometries(aprons)!, houseMat);
    apronMesh.name = 'vorplaetze';
    apronMesh.receiveShadow = true;
    group.add(apronMesh);
  }
  const paths = createFrontPaths(frontPaths, terrain, mulberry32(seed ^ 0xa11e));
  group.add(paths.group);
  group.add(createShopFronts(shops, terrain, mulberry32(seed ^ 0x5f0f)));
  group.userData.pathLines = paths.lines;
  group.userData.footprints = footprints;
  group.userData.shops = shops.map((sh) => ({ type: sh.type, name: sh.name, x: sh.x, z: sh.z }));

  // --- Bäume, Büsche, Felsen ---------------------------------------------------------------
  const conifers: Instance[] = [];
  const leafy: Instance[] = [];
  const bushes: Instance[] = [...gardenBushes];
  const rocks: Instance[] = [];
  const half = terrain.half;
  const redRocks: Instance[] = [];
  // Gleiche Dichte wie früher auf 3 × 3 km, darum Versuche nach Fläche
  const tries = Math.round(18000 * (terrain.size / 3000) ** 2);
  for (let k = 0; k < tries; k++) {
    const x = (rng() * 2 - 1) * half * 0.98;
    const z = (rng() * 2 - 1) * half * 0.98;
    const y = terrain.sample(x, z);
    if (y < 3) continue;
    const slope = terrain.slope(x, z);
    const mask = roads.maskAt(terrain, x, z);
    const steppe = steppeMask(x, z);
    if (steppe > 0.5) {
      // Glutsteppe: rote Felsbrocken, Büsche und vereinzelte Bäume
      if (mask > 0.05) continue;
      const r = rng();
      if (slope > 0.3 || r < 0.05) {
        if (rng() < 0.35 && occupied.tryTake(x, z, 1)) redRocks.push({ matrix: mat(x, y - 0.3, z, rng() * 6, 0.8 + rng() * 2.4, 0.6 + rng() * 1.2, 0.8 + rng() * 2) });
      } else if (r < 0.12) {
        if (occupied.tryTake(x, z, 1)) bushes.push({ matrix: mat(x, y - 0.1, z, rng() * 6, 0.5 + rng() * 0.6), color: new THREE.Color('#c8b878') });
      } else if (r < 0.135 && occupied.tryTake(x, z, 2)) {
        leafy.push({ matrix: mat(x, y - 0.2, z, rng() * 6, 0.6 + rng() * 0.3, 0.5 + rng() * 0.3, 0.6 + rng() * 0.3) });
      }
      continue;
    }
    // Am Kogel wächst auch an den steilen Flanken Bergwald
    const steepLimit = kogelMask(x, z) > 0.03 ? 0.95 : 0.45;
    if (slope > steepLimit) {
      if (rng() < 0.15) rocks.push({ matrix: mat(x, y - 0.2, z, rng() * 6, 0.8 + rng() * 1.6) });
      continue;
    }
    if (mask > 0.05) continue;
    const town = townMask(x, z);
    if (town > 0.2) {
      // In der Stadt nur vereinzelte Laubbäume in Gärten
      if (town < 0.9 && rng() < 0.03 && occupied.tryTake(x, z, 3)) {
        leafy.push({ matrix: mat(x, y - 0.2, z, rng() * 6, 0.7 + rng() * 0.4) });
      }
      continue;
    }
    if (y > TREELINE - 40) {
      // Kogel: lichter Bergwald an der Baumgrenze, darüber Almwiesen mit Felsbrocken
      const r = rng();
      const forest = 1 - smoothstep(TREELINE - 40, TREELINE + 25, y);
      if (r < forest * 0.7) {
        if (!occupied.tryTake(x, z, 1)) continue;
        const sc = 0.6 + rng() * 0.6;
        conifers.push({ matrix: mat(x, y - 0.2, z, rng() * 6, sc, sc * (0.9 + rng() * 0.5), sc) });
      } else if (y > SCREE_LINE - 30 ? r > 0.88 : r > 0.97) {
        rocks.push({ matrix: mat(x, y - 0.2, z, rng() * 6, 0.6 + rng() * 1.4) });
      } else if (r > 0.94 && occupied.tryTake(x, z, 1)) {
        bushes.push({ matrix: mat(x, y - 0.1, z, rng() * 6, 0.5 + rng() * 0.5), color: new THREE.Color('#8fa858') });
      }
      continue;
    }
    const density = 0.22 + Math.min(0.6, y / 250) + (z < -600 ? 0.2 : 0);
    const r = rng();
    if (r > density) {
      // Offene Landschaft: Büsche und vereinzelte Felsen
      if (r > 0.97 && occupied.tryTake(x, z, 1)) bushes.push({ matrix: mat(x, y - 0.1, z, rng() * 6, 0.7 + rng() * 0.8) });
      continue;
    }
    if (!occupied.tryTake(x, z, 1)) continue;
    const sc = 0.7 + rng() * 0.8;
    // Unten Laubwald, oben Nadelwald, dazwischen gemischt
    const leafChance = 1 - Math.min(1, Math.max(0, (y - 60) / 110));
    if (rng() < leafChance * 0.75) leafy.push({ matrix: mat(x, y - 0.2, z, rng() * 6, sc, sc * (0.85 + rng() * 0.3), sc) });
    else conifers.push({ matrix: mat(x, y - 0.2, z, rng() * 6, sc, sc * (0.8 + rng() * 0.5), sc) });
  }
  // Laubbäume leicht unterschiedlich getönt
  const leafTints = ['#ffffff', '#e8f0c8', '#f6e7a8', '#d9eec0'];
  leafy.forEach((t) => (t.color ??= new THREE.Color(leafTints[Math.floor(rng() * leafTints.length)]!)));
  // Bäume in der Steppe: staubig, olivgrün
  for (const t of leafy) {
    const p = new THREE.Vector3().setFromMatrixPosition(t.matrix);
    if (steppeMask(p.x, p.z) > 0.5) t.color = new THREE.Color('#d8d090');
  }
  // Bäume, Büsche und Felsen in Kacheln; Bäume in der Ferne als einfache Form
  const plantMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const sets: [string, THREE.BufferGeometry, THREE.BufferGeometry | null, Instance[], number, number, boolean][] = [
    ['nadelbaum', conifer(), coniferFar(), conifers, 220, 3000, true],
    ['laubbaum', deciduous(), deciduousFar(), leafy, 220, 3000, true],
    ['busch', bush(), null, bushes, 600, 600, false],
    ['fels', rock(), null, rocks, 1400, 1400, true],
    ['rotfels', redRock(), null, redRocks, 1400, 1400, true],
  ];
  for (const [name, near, far, items, nearDist, hideDist, shadow] of sets) {
    if (items.length === 0) continue;
    group.add(lod.add(new DynamicLod({ name, near, far, material: plantMat, nearDist, hideDist, castShadow: shadow, farShadow: false }, items)).group);
  }


  // --- Schranken an gesperrten Wegenden ------------------------------------------------------
  // Vor freischaltbaren Gebieten mit Schild; die Spielseite blendet sie beim Freischalten aus
  const gates: Record<string, THREE.Object3D> = {};
  for (const n of roads.nodes.values()) {
    if (!n.gate) continue;
    // Führt ein Weg ins Gebiet, steht die Schranke ein Stück darauf (quer zu ihm), damit
    // offene Wege durch den Knoten frei bleiben; sonst am Wegende quer zum Zufahrtsweg.
    const inner = n.edges.map((id) => roads.edge(id)).find((e) => e.region !== undefined);
    const e = inner ?? roads.edge(n.edges[0]!);
    const atEnd = e.to === n.id;
    const inset = inner ? Math.min(7, e.length / 2) : 0;
    const at = e.pointAt(atEnd ? e.length - inset : inset);
    const raw = e.directionAt(atEnd ? e.length - inset : inset);
    // Fahrtrichtung einer Fahrerin, die auf die Schranke zufährt
    const sign0 = (inner ? !atEnd : atEnd) ? 1 : -1;
    const d = { dx: raw.dx * sign0, dz: raw.dz * sign0 };
    const gate = new THREE.Group();
    gate.name = `schranke-${n.id}`;
    const barrier = new THREE.Mesh(
      merged([
        painted(new THREE.BoxGeometry(7, 0.5, 0.3), '#d33'),
        ...[-2.4, -0.8, 0.8, 2.4].map((x) => painted(new THREE.BoxGeometry(0.8, 0.52, 0.32).translate(x, 0, 0), '#f4f4f4')),
      ]),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    barrier.position.set(at.x, at.y + 1.1, at.z);
    barrier.rotation.y = Math.atan2(d.dx, d.dz) + Math.PI / 2;
    gate.add(barrier);
    for (const side of [-3.2, 3.2]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.3, 6),
        new THREE.MeshLambertMaterial({ color: '#eee' }),
      );
      post.position.set(at.x - d.dz * side, at.y + 0.65, at.z + d.dx * side);
      gate.add(post);
    }
    const region = REGIONS.find((r) => r.gateNodes.includes(n.id));
    if (region) {
      // Schild neben der Schranke, zur ankommenden Fahrerin gedreht
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshLambertMaterial({ map: gateSignTexture(region.name, region.unlockLevel) }));
      const sx = at.x - d.dz * 4.4 - d.dx * 1.5;
      const sz = at.z + d.dx * 4.4 - d.dz * 1.5;
      sign.position.set(sx, at.y + 1.9, sz);
      sign.rotation.y = Math.atan2(-d.dx, -d.dz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), new THREE.MeshLambertMaterial({ color: '#555' }));
      pole.position.set(sx, at.y + 1.3, sz);
      gate.add(sign, pole);
    }
    gates[n.id] = gate;
    group.add(gate);
  }
  group.userData.gates = gates;

  group.userData.counts = {
    houses: instances[0]!.flat().length + instances[2]!.flat().length,
    townhouses: instances[1]!.flat().length + instances[3]!.flat().length,
    barns: barns.length, paths: frontPaths.length, shops: shops.length,
    conifers: conifers.length, leafy: leafy.length, bushes: bushes.length, rocks: rocks.length,
  };
  return group;
}
