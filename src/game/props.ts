import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';
import { mulberry32 } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { townMask } from '../world/terrainGen';

/** Färbt eine Geometrie einheitlich (für zusammengeführte Low-Poly-Modelle). */
function painted(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function treeGeometry(): THREE.BufferGeometry {
  const trunk = painted(new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0), '#7a5a3a');
  const crownLow = painted(new THREE.ConeGeometry(2.2, 4, 6).translate(0, 3.6, 0), '#3f7a34');
  const crownTop = painted(new THREE.ConeGeometry(1.6, 3, 6).translate(0, 5.6, 0), '#4a8a3a');
  return mergeGeometries([trunk, crownLow, crownTop])!;
}

function houseGeometry(): THREE.BufferGeometry {
  const body = painted(new THREE.BoxGeometry(8, 5, 7).translate(0, 2.5, 0), '#ffffff');
  const roof = painted(
    new THREE.ConeGeometry(6.4, 3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.9).translate(0, 6.5, 0),
    '#b5523b',
  );
  return mergeGeometries([body, roof])!;
}

const WALL_COLORS = ['#f2e6d0', '#e8d4b0', '#f5efe6', '#e6c9a8', '#d9e2e6', '#f0d9c8'];

/** Einfaches Belegungsraster, damit sich Objekte nicht überlappen. */
class Occupancy {
  private cells = new Set<string>();
  constructor(private readonly size: number) {}
  private key(x: number, z: number) {
    return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
  }
  tryTake(x: number, z: number): boolean {
    const k = this.key(x, z);
    if (this.cells.has(k)) return false;
    this.cells.add(k);
    return true;
  }
}

export function createProps(terrain: Heightfield, roads: RoadNetwork, seed: number): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(seed ^ 0x1234567);
  const occupied = new Occupancy(12);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();

  // --- Häuser: entlang der Stadtstraßen und um die Dörfer ---------------------
  const houses: THREE.Matrix4[] = [];
  const houseColors: THREE.Color[] = [];
  const villageCenters = [...roads.nodes.values()].filter((n) => n.name?.endsWith('dorf'));

  for (const e of roads.edges.values()) {
    for (let s = 10; s < e.length - 10; s += 16) {
      const p = e.pointAt(s);
      const inTown = townMask(p.x, p.z) > 0.7;
      const nearVillage = villageCenters.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 140);
      if (!inTown && !nearVillage) continue;
      if (!inTown && rng() < 0.5) continue;
      const d = e.directionAt(s);
      for (const side of [1, -1]) {
        if (rng() < 0.2) continue;
        const off = 13 + rng() * 3;
        const x = p.x - d.dz * off * side;
        const z = p.z + d.dx * off * side;
        if (roads.maskAt(terrain, x, z) > 0.75) continue; // zu nah an einem anderen Weg
        const y = terrain.sample(x, z);
        if (y < 2 || !occupied.tryTake(x, z)) continue;
        // Giebel zur Straße
        q.setFromAxisAngle(up, Math.atan2(d.dx, d.dz));
        const sc = 0.8 + rng() * 0.5;
        scale.set(sc, 0.8 + rng() * (inTown ? 0.9 : 0.4), sc);
        pos.set(x, y - 0.3, z);
        houses.push(new THREE.Matrix4().compose(pos, q, scale));
        houseColors.push(new THREE.Color(WALL_COLORS[Math.floor(rng() * WALL_COLORS.length)]!));
      }
    }
  }

  const houseMesh = new THREE.InstancedMesh(
    houseGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    Math.max(1, houses.length),
  );
  houses.forEach((mat, i) => {
    houseMesh.setMatrixAt(i, mat);
    houseMesh.setColorAt(i, houseColors[i]!);
  });
  houseMesh.count = houses.length;
  houseMesh.castShadow = true;
  houseMesh.receiveShadow = true;
  group.add(houseMesh);

  // --- Bäume: Gruppen per Zufall, nicht auf Wegen, nicht in der Stadt ---------
  const trees: THREE.Matrix4[] = [];
  const half = terrain.half;
  const ATTEMPTS = 14000;
  for (let k = 0; k < ATTEMPTS; k++) {
    const x = (rng() * 2 - 1) * half * 0.98;
    const z = (rng() * 2 - 1) * half * 0.98;
    const y = terrain.sample(x, z);
    if (y < 3) continue;
    if (townMask(x, z) > 0.2) continue;
    if (roads.maskAt(terrain, x, z) > 0.05) continue;
    if (terrain.slope(x, z) > 0.45) continue;
    // Dichte: mehr Wald in der Höhe und im Norden
    const density = 0.25 + Math.min(0.6, y / 250) + (z < -600 ? 0.2 : 0);
    if (rng() > density) continue;
    const sc = 0.7 + rng() * 0.8;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    pos.set(x, y - 0.2, z);
    scale.set(sc, sc * (0.8 + rng() * 0.5), sc);
    m.compose(pos, q, scale);
    trees.push(m.clone());
  }
  const treeMesh = new THREE.InstancedMesh(
    treeGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    Math.max(1, trees.length),
  );
  trees.forEach((mat, i) => treeMesh.setMatrixAt(i, mat));
  treeMesh.count = trees.length;
  treeMesh.castShadow = true;
  group.add(treeMesh);

  // --- Schranken an gesperrten Wegenden ---------------------------------------
  for (const n of roads.nodes.values()) {
    if (!n.gate) continue;
    const e = roads.edge(n.edges[0]!);
    const atEnd = e.to === n.id;
    const d = e.directionAt(atEnd ? e.length : 0);
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.5, 0.3),
      new THREE.MeshLambertMaterial({ color: '#d33' }),
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

  return group;
}
