import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad, REBLAND } from '../world/placement';
import { mulberry32 } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { townMask } from '../world/terrainGen';
import { merged, painted } from './details';
import { createFrontPaths, createHouseVariants, tintedMaterial, type FrontPath } from './houses';
import { createShopFronts, type ShopPlacement } from './shopFronts';
import { assignShops, type ShopSlot } from '../world/shops';

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

function bush(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.IcosahedronGeometry(0.9, 0).scale(1.3, 0.8, 1.1).translate(0, 0.55, 0), '#5c9a3a'),
    painted(new THREE.IcosahedronGeometry(0.6, 0).translate(0.7, 0.5, 0.3), '#68a843'),
  ]);
}

function rock(): THREE.BufferGeometry {
  return painted(new THREE.DodecahedronGeometry(1, 0).scale(1.4, 0.8, 1.1).translate(0, 0.3, 0), '#9a958c');
}

/** Scheune: breit, niedrig, Holz, großes Tor. */
function barn(): THREE.BufferGeometry {
  const w = 12, d = 8, h = 4.5;
  return merged([
    painted(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), '#9a6b45'),
    painted(new THREE.ConeGeometry(8.6, 3.4, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.68).translate(0, h + 1.7, 0), '#6f4a32'),
    painted(new THREE.BoxGeometry(3.4, 3.4, 0.1).translate(0, 1.7, d / 2 + 0.05), '#5a3a24'),
    painted(new THREE.BoxGeometry(3.6, 0.15, 0.12).translate(0, 3.45, d / 2 + 0.08), '#e8e0d0'),
  ]);
}

const WALL_COLORS = ['#f2e6d0', '#e8d4b0', '#f5efe6', '#e6c9a8', '#d9e2e6', '#f0d9c8', '#e9c3b5'];
const TOWNHOUSE_COLORS = ['#e8b796', '#f0d58c', '#c9d8e0', '#f2e6d0', '#d8b0a0', '#e0e8c8'];

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

function toMesh(geo: THREE.BufferGeometry, items: Instance[], castShadow = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    Math.max(1, items.length),
  );
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.count = items.length;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
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
  }
  const buildings: Building[] = [];

  for (const e of roads.edges.values()) {
    for (let s = 12; s < e.length - 12; s += 15) {
      const p = e.pointAt(s);
      const town = townMask(p.x, p.z) > 0.7;
      const toMarkt = markt ? Math.hypot(p.x - markt.x, p.z - markt.z) : Infinity;
      const core = town && toMarkt < 260;
      const village = villages.find((v) => Math.hypot(v.x - p.x, v.z - p.z) < 150);
      const rural = !town && !village && Math.hypot(p.x - REBLAND.x, p.z - REBLAND.z) < REBLAND.radius + 200;
      if (!town && !village && !(rural && rng() < 0.035)) continue;
      if (village && rng() < 0.45) continue;
      const d = e.directionAt(s);
      for (const side of [1, -1]) {
        if (rng() < (core ? 0.08 : 0.25)) continue;
        const kind = core ? 'townhouse' : rural ? 'barn' : 'house';
        const off = kind === 'barn' ? 18 : kind === 'townhouse' ? 12 : 13 + rng() * 3;
        const x = p.x - d.dz * off * side;
        const z = p.z + d.dx * off * side;
        if (distanceToRoad(roads, x, z, undefined, 30) < (kind === 'barn' ? 11 : 8)) continue;
        const y = terrain.sample(x, z);
        if (y < 2 || terrain.slope(x, z) > 0.3 || seaward(x, z, -d.dz * side, d.dx * side)) continue;
        if (!occupied.tryTake(x, z, kind === 'barn' ? 9 : 5)) continue;

        // Lage für die Ladenverteilung
        const toHafen = hafen ? Math.hypot(x - hafen.x, z - hafen.z) : Infinity;
        let slot: Omit<ShopSlot, 'id'>;
        if (kind === 'barn') slot = { x, z, district: 'land', town: 'land', centerDist: 0, barn: true };
        else if (village) slot = { x, z, district: 'dorf', town: village.id, centerDist: Math.hypot(x - village.x, z - village.z), barn: false };
        else if (town && toHafen < 170) slot = { x, z, district: 'hafen', town: 'lumen', centerDist: toHafen, barn: false };
        else slot = { x, z, district: core ? 'kern' : 'stadt', town: 'lumen', centerDist: toMarkt, barn: false };

        buildings.push({
          kind, x, y, z,
          // Front (+z) zur Straße
          rot: Math.atan2(d.dz * side, -d.dx * side),
          off,
          edgeOff: e.surface === 'town' ? 5.15 : e.surface === 'gravel' ? 2.4 : 3.2,
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
    const vi = Math.floor(rng() * list.length);
    const variant = list[vi]!;
    const sc = town ? 1 : 0.85 + rng() * 0.25;
    const sy = town ? 0.92 + rng() * 0.2 : 0.9 + rng() * 0.15;
    const matrix = mat(b.x, b.y - 0.3, b.z, b.rot, sc, sy, sc);
    const palette = town ? TOWNHOUSE_COLORS : WALL_COLORS;
    instances[listIndex]![vi]!.push({ matrix, color: new THREE.Color(palette[Math.floor(rng() * palette.length)]!) });

    // Grundfläche (für die Grasmaske: kein Gras an den Wänden)
    const hw = (town ? 3 : 4) + 0.4;
    const hd = (town ? 4.5 : 3.5) + 0.4;
    footprints.push([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => {
      doorPoint.set(lx!, 0, lz!).applyMatrix4(matrix);
      return { x: doorPoint.x, z: doorPoint.z };
    }));

    const depth = b.off - variant.front * sc - b.edgeOff;
    if (shop) {
      shops.push({
        type: shop.type, name: shop.name, x: b.x, y: b.y - 0.3, z: b.z, rot: b.rot, sc, sy,
        front: variant.front, window: variant.shop, door: variant.door, depth,
      });
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

  const tinted = (geo: THREE.BufferGeometry, items: Instance[]) => {
    const m = toMesh(geo, items);
    m.material = tintedMaterial();
    return m;
  };
  variantLists.forEach((list, li) => list.forEach((v, vi) => group.add(tinted(v.geometry, instances[li]![vi]!))));
  group.add(toMesh(barn(), barns));
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
  for (let k = 0; k < 18000; k++) {
    const x = (rng() * 2 - 1) * half * 0.98;
    const z = (rng() * 2 - 1) * half * 0.98;
    const y = terrain.sample(x, z);
    if (y < 3) continue;
    const slope = terrain.slope(x, z);
    const mask = roads.maskAt(terrain, x, z);
    if (slope > 0.45) {
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
  leafy.forEach((t) => (t.color = new THREE.Color(leafTints[Math.floor(rng() * leafTints.length)]!)));
  group.add(toMesh(conifer(), conifers), toMesh(deciduous(), leafy), toMesh(bush(), bushes, false), toMesh(rock(), rocks));

  // --- Schranken an gesperrten Wegenden ------------------------------------------------------
  for (const n of roads.nodes.values()) {
    if (!n.gate) continue;
    const e = roads.edge(n.edges[0]!);
    const atEnd = e.to === n.id;
    const d = e.directionAt(atEnd ? e.length : 0);
    const barrier = new THREE.Mesh(
      painted(new THREE.BoxGeometry(7, 0.5, 0.3), '#d33'),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    barrier.position.set(n.x, n.y + 1.1, n.z);
    barrier.rotation.y = Math.atan2(d.dx, d.dz) + Math.PI / 2;
    group.add(barrier);
    for (const side of [-3.2, 3.2]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.3, 6),
        new THREE.MeshLambertMaterial({ color: '#eee' }),
      );
      post.position.set(n.x - d.dz * side, n.y + 0.65, n.z + d.dx * side);
      group.add(post);
    }
  }

  group.userData.counts = {
    houses: instances[0]!.flat().length + instances[2]!.flat().length,
    townhouses: instances[1]!.flat().length + instances[3]!.flat().length,
    barns: barns.length, paths: frontPaths.length, shops: shops.length,
    conifers: conifers.length, leafy: leafy.length, bushes: bushes.length, rocks: rocks.length,
  };
  return group;
}
