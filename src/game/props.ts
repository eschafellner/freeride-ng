import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad, REBLAND } from '../world/placement';
import { mulberry32 } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { townMask } from '../world/terrainGen';
import { merged, painted } from './details';

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

/** Fenster und Tür auf der Vorderseite (+z) eines Quaders der Breite w und Tiefe d. */
function facade(w: number, d: number, floors: number, floorH: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const front = d / 2 + 0.03;
  const win = '#3a4a5c';
  // Tür
  parts.push(painted(new THREE.BoxGeometry(1.0, 2.0, 0.08).translate(0, 1.0, front), '#6b4226'));
  for (let f = 0; f < floors; f++) {
    const y = f * floorH + floorH * 0.6;
    for (const x of [-w / 3, w / 3]) {
      if (f === 0 && Math.abs(x) < 0.8) continue;
      parts.push(painted(new THREE.BoxGeometry(0.9, 1.0, 0.08).translate(x, y, front), win));
      parts.push(painted(new THREE.BoxGeometry(0.9, 1.0, 0.08).translate(x, y, -front), win));
    }
  }
  // Seitliche Fenster
  for (let f = 0; f < floors; f++) {
    parts.push(painted(new THREE.BoxGeometry(0.08, 1.0, 0.9).translate(w / 2 + 0.03, f * floorH + floorH * 0.6, 0), win));
  }
  return parts;
}

/** Wohnhaus: zwei Geschosse, Satteldach. Wände weiß, per Instanzfarbe getönt. */
function house(): THREE.BufferGeometry {
  const w = 8, d = 7, h = 5;
  return merged([
    painted(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), '#ffffff'),
    painted(new THREE.ConeGeometry(6.4, 3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.9).translate(0, h + 1.5, 0), '#b5523b'),
    painted(new THREE.BoxGeometry(0.7, 1.6, 0.7).translate(2.2, h + 1.8, 0), '#8d8d8d'), // Kamin
    ...facade(w, d, 2, 2.5),
  ]);
}

/** Stadthaus: schmal, drei Geschosse, flaches Walmdach. */
function townhouse(): THREE.BufferGeometry {
  const w = 6, d = 9, h = 8.5;
  return merged([
    painted(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), '#ffffff'),
    painted(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4).translate(0, h, 0), '#d8d2c4'),
    painted(new THREE.ConeGeometry(5.6, 1.8, 4).rotateY(Math.PI / 4).scale(0.75, 1, 1.1).translate(0, h + 1.05, 0), '#9c4a36'),
    ...facade(w, d, 3, 2.8),
  ]);
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
  for (const r of reserved) occupied.tryTake(r.x, r.z, r.r);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const mat = (x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(pos.set(x, y, z), q.setFromAxisAngle(up, rot), scale.set(sx, sy, sz));

  // --- Gebäude entlang der Wege ---------------------------------------------------------
  const houses: Instance[] = [];
  const townhouses: Instance[] = [];
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

  for (const e of roads.edges.values()) {
    for (let s = 12; s < e.length - 12; s += 15) {
      const p = e.pointAt(s);
      const town = townMask(p.x, p.z) > 0.7;
      const core = town && markt !== undefined && Math.hypot(p.x - markt.x, p.z - markt.z) < 260;
      const village = villages.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 150);
      const rural = !town && !village && Math.hypot(p.x - REBLAND.x, p.z - REBLAND.z) < REBLAND.radius + 200;
      if (!town && !village && !(rural && rng() < 0.035)) continue;
      if (village && rng() < 0.45) continue;
      const d = e.directionAt(s);
      for (const side of [1, -1]) {
        if (rng() < (core ? 0.08 : 0.25)) continue;
        const type = core ? 'townhouse' : rural ? 'barn' : 'house';
        const off = type === 'barn' ? 18 : type === 'townhouse' ? 12 : 13 + rng() * 3;
        const x = p.x - d.dz * off * side;
        const z = p.z + d.dx * off * side;
        if (distanceToRoad(roads, x, z, undefined, 30) < (type === 'barn' ? 11 : 8)) continue;
        const y = terrain.sample(x, z);
        if (y < 2 || terrain.slope(x, z) > 0.3 || seaward(x, z, -d.dz * side, d.dx * side)) continue;
        if (!occupied.tryTake(x, z, type === 'barn' ? 9 : 5)) continue;
        // Front (+z) zur Straße
        const rot = Math.atan2(d.dz * side, -d.dx * side);
        if (type === 'townhouse') {
          townhouses.push({
            matrix: mat(x, y - 0.3, z, rot, 1, 0.9 + rng() * 0.35, 1),
            color: new THREE.Color(TOWNHOUSE_COLORS[Math.floor(rng() * TOWNHOUSE_COLORS.length)]!),
          });
        } else if (type === 'barn') {
          barns.push({ matrix: mat(x, y - 0.3, z, rot, 0.9 + rng() * 0.3) });
        } else {
          const sc = 0.85 + rng() * 0.35;
          houses.push({
            matrix: mat(x, y - 0.3, z, rot, sc, 0.85 + rng() * (town ? 0.6 : 0.3), sc),
            color: new THREE.Color(WALL_COLORS[Math.floor(rng() * WALL_COLORS.length)]!),
          });
        }
      }
    }
  }
  group.add(toMesh(house(), houses), toMesh(townhouse(), townhouses), toMesh(barn(), barns));

  // --- Bäume, Büsche, Felsen ---------------------------------------------------------------
  const conifers: Instance[] = [];
  const leafy: Instance[] = [];
  const bushes: Instance[] = [];
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
    houses: houses.length, townhouses: townhouses.length, barns: barns.length,
    conifers: conifers.length, leafy: leafy.length, bushes: bushes.length, rocks: rocks.length,
  };
  return group;
}
