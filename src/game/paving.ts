import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import type { RoadNetwork } from '../world/roadNetwork';
import { PLAZAS } from './shaderChunks';

/** Halbe Fahrbahnbreite der Stadtstraßen (siehe roadMesh.ts). */
const TOWN_HALF = 3.25;
const WALK_WIDTH = 1.9;
/** Gehsteigkante über der Fahrbahn. */
const CURB = 0.14;
/** Fahrbahn liegt so hoch über dem Wegprofil (roadMesh LIFT). */
const ROAD_LIFT = 0.12;
/** Abstand der Gehsteige zu Kreuzungen, damit sie keine Querstraße überdecken. */
const NODE_GAP = 9;

const WALK = new THREE.Color('#c4bcae');
const WALK_EDGE = new THREE.Color('#9d968a');
const PLAZA_A = new THREE.Color('#cbbfa8');
const PLAZA_B = new THREE.Color('#b3a68e');

/**
 * Gehsteige an den Stadtstraßen und gepflasterte Plätze (Marktplatz, Hafenplatz).
 * Ein Mesh mit Vertexfarben.
 */
export function createPaving(terrain: Heightfield, roads: RoadNetwork): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  const plazaAt = (x: number, z: number) =>
    PLAZAS.some((p) => {
      const n = roads.nodes.get(p.node);
      return n !== undefined && Math.hypot(x - n.x, z - n.z) < p.radius - 1;
    });

  for (const e of roads.edges.values()) {
    if (e.surface !== 'town') continue;
    for (const side of [1, -1]) {
      for (let i = 0; i + 1 < e.count; i++) {
        const s0 = e.ss[i]!;
        const s1 = e.ss[i + 1]!;
        if (s0 < NODE_GAP || s1 > e.length - NODE_GAP) continue;
        const pts = [i, i + 1].map((k) => {
          const d = e.directionAt(e.ss[k]!);
          const px = -d.dz * side;
          const pz = d.dx * side;
          const x = e.xs[k]!;
          const z = e.zs[k]!;
          const y = e.ys[k]! + ROAD_LIFT + CURB;
          return {
            inX: x + px * TOWN_HALF, inZ: z + pz * TOWN_HALF,
            outX: x + px * (TOWN_HALF + WALK_WIDTH), outZ: z + pz * (TOWN_HALF + WALK_WIDTH),
            y, roadY: e.ys[k]! + ROAD_LIFT,
          };
        });
        const [p, q] = pts as [typeof pts[0], typeof pts[0]];
        if (plazaAt(p.inX, p.inZ) || plazaAt(q.inX, q.inZ)) continue;
        // Oberfläche (Reihenfolge so, dass die Fläche nach oben zeigt)
        const top = side === 1
          ? [[p.inX, p.y, p.inZ], [p.outX, p.y, p.outZ], [q.outX, q.y, q.outZ], [q.inX, q.y, q.inZ]]
          : [[p.inX, p.y, p.inZ], [q.inX, q.y, q.inZ], [q.outX, q.y, q.outZ], [p.outX, p.y, p.outZ]];
        quad(top[0]!, top[1]!, top[2]!, top[3]!, WALK);
        // Bordstein zur Fahrbahn hin
        const curb = side === 1
          ? [[p.inX, p.roadY, p.inZ], [p.inX, p.y, p.inZ], [q.inX, q.y, q.inZ], [q.inX, q.roadY, q.inZ]]
          : [[p.inX, p.roadY, p.inZ], [q.inX, q.roadY, q.inZ], [q.inX, q.y, q.inZ], [p.inX, p.y, p.inZ]];
        quad(curb[0]!, curb[1]!, curb[2]!, curb[3]!, WALK_EDGE);
      }
    }
  }

  // Plätze: konzentrische Ringe aus Pflaster in zwei Tönen, folgen dem Gelände
  for (const p of PLAZAS) {
    const n = roads.nodes.get(p.node);
    if (!n) continue;
    const rings = Math.round(p.radius / 3);
    const segs = 40;
    const yAt = (x: number, z: number) => Math.max(n.y, terrain.meshHeight(x, z)) + ROAD_LIFT - 0.04;
    for (let r = 0; r < rings; r++) {
      const r0 = (r / rings) * p.radius;
      const r1 = ((r + 1) / rings) * p.radius;
      const color = r % 2 === 0 ? PLAZA_A : PLAZA_B;
      for (let k = 0; k < segs; k++) {
        const a0 = (k / segs) * Math.PI * 2;
        const a1 = ((k + 1) / segs) * Math.PI * 2;
        const v = (rad: number, a: number) => {
          const x = n.x + Math.cos(a) * rad;
          const z = n.z + Math.sin(a) * rad;
          return [x, yAt(x, z), z];
        };
        // Leichte Farbvariation pro Stein
        const c = color.clone().multiplyScalar(0.94 + ((k * 7 + r * 13) % 5) * 0.03);
        quad(v(r0, a0), v(r0, a1), v(r1, a1), v(r1, a0), c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}
