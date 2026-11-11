import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { fieldAt, REBLAND } from '../world/placement';
import { mulberry32 } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { townMask } from '../world/terrainGen';

const COLORS = {
  sand: new THREE.Color('#e3cf9a'),
  grassA: new THREE.Color('#7fb24a'),
  grassB: new THREE.Color('#6aa13f'),
  meadow: new THREE.Color('#9cc25a'),
  forest: new THREE.Color('#4f8a3a'),
  rock: new THREE.Color('#9a9184'),
  town: new THREE.Color('#c9c2b0'),
  verge: new THREE.Color('#7f9e4a'),
  seabed: new THREE.Color('#c8b98a'),
  vineyardSoil: new THREE.Color('#a08a5a'),
};

/** Feldarten: reifes Getreide, junges Grün, Acker, Raps. */
const FIELD_COLORS = ['#d8c26a', '#a9cf5c', '#9a7a52', '#e6d84a'].map((c) => new THREE.Color(c));

/**
 * Low-Poly-Gelände: jedes Dreieck hat eine eigene, flache Farbe
 * (nicht indizierte Geometrie → flache Normalen).
 */
export function createTerrainMesh(terrain: Heightfield, roads: RoadNetwork, seed: number): THREE.Mesh {
  const res = terrain.res;
  const cells = res - 1;
  const triCount = cells * cells * 2;
  const positions = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 9);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const tmp = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();

  let p = 0;
  const pushTri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number) => {
    a.set(terrain.worldX(i0), terrain.get(i0, j0), terrain.worldZ(j0));
    b.set(terrain.worldX(i1), terrain.get(i1, j1), terrain.worldZ(j1));
    c.set(terrain.worldX(i2), terrain.get(i2, j2), terrain.worldZ(j2));

    // Flächennormale für die Farbwahl (Fels an steilen Stellen)
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const h = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const mask = roads.maskAt(terrain, cx, cz);
    const r = rng();

    const steep = Math.abs(n.y) < 0.82;
    if (h < -0.5) tmp.copy(COLORS.seabed);
    else if (h < 2.5) tmp.copy(COLORS.sand);
    // Böschungen an Wegen: begrünt statt Fels
    else if (mask > 0.15) tmp.copy(COLORS.verge).lerp(COLORS.grassB, steep ? 0.2 : 0.5 + r * 0.3);
    else if (steep) tmp.copy(COLORS.rock);
    else if (townMask(cx, cz) > 0.6) tmp.copy(COLORS.grassA).lerp(COLORS.town, 0.35 + r * 0.25);
    else if (Math.hypot(cx - REBLAND.x, cz - REBLAND.z) < REBLAND.radius && h > 15) {
      // Rebland: Wiese mit offenen Bodenstellen zwischen den Weinbergen
      tmp.copy(COLORS.grassA).lerp(COLORS.vineyardSoil, 0.25 + r * 0.3);
    } else if (h < 90 && Math.abs(n.y) > 0.985 && mask < 0.05) {
      // Flachland: Flickenteppich aus Feldern
      const f = fieldAt(cx, cz, seed);
      if (f === null) tmp.copy(COLORS.grassA).lerp(COLORS.meadow, r * 0.4);
      else tmp.copy(FIELD_COLORS[f]!).lerp(COLORS.grassB, r * 0.08);
    }
    else if (h > 150) tmp.copy(COLORS.forest).lerp(COLORS.rock, r * 0.3);
    else tmp.copy(r < 0.5 ? COLORS.grassA : COLORS.grassB).lerp(COLORS.meadow, r * 0.4);

    for (const v of [a, b, c]) {
      positions[p] = v.x;
      positions[p + 1] = v.y;
      positions[p + 2] = v.z;
      colors[p] = tmp.r;
      colors[p + 1] = tmp.g;
      colors[p + 2] = tmp.b;
      p += 3;
    }
  };

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      // Diagonale abwechselnd, wirkt weniger gleichförmig
      if ((i + j) % 2 === 0) {
        pushTri(i, j, i, j + 1, i + 1, j);
        pushTri(i + 1, j, i, j + 1, i + 1, j + 1);
      } else {
        pushTri(i, j, i, j + 1, i + 1, j + 1);
        pushTri(i, j, i + 1, j + 1, i + 1, j);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  return mesh;
}

export function createWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(20000, 20000);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: '#3d86c6', transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  return mesh;
}
