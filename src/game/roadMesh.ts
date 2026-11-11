import * as THREE from 'three';
import type { Surface } from '../world/roadLayout';
import type { RoadEdge, RoadNetwork } from '../world/roadNetwork';

const SURFACE: Record<Surface, { width: number; color: string }> = {
  asphalt: { width: 5, color: '#55585e' },
  town: { width: 6.5, color: '#8a837a' },
  gravel: { width: 4, color: '#b59f78' },
};

/** Abstand der Fahrbahn über dem eingeschnittenen Gelände. */
const LIFT = 0.12;

function addRibbon(edge: RoadEdge, width: number, color: THREE.Color, pos: number[], col: number[], idx: number[]) {
  const half = width / 2;
  const base = pos.length / 3;
  for (let i = 0; i < edge.count; i++) {
    const d = edge.directionAt(edge.ss[i]!);
    // Senkrechte in der Ebene (x, z)
    const px = -d.dz;
    const pz = d.dx;
    const x = edge.xs[i]!;
    const y = edge.ys[i]! + LIFT;
    const z = edge.zs[i]!;
    pos.push(x + px * half, y, z + pz * half, x - px * half, y, z - pz * half);
    col.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (i > 0) {
      const v = base + i * 2;
      idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
}

/** Alle Wege als ein einziges Mesh; Kreuzungen bekommen eine runde Platte. */
export function createRoadMesh(roads: RoadNetwork): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const color = new THREE.Color();

  for (const e of roads.edges.values()) {
    const s = SURFACE[e.surface];
    color.set(s.color);
    addRibbon(e, s.width, color, pos, col, idx);
  }

  // Kreuzungsplatten
  for (const n of roads.nodes.values()) {
    if (n.edges.length < 2) continue;
    const widest = Math.max(...n.edges.map((id) => SURFACE[roads.edge(id).surface].width));
    color.set(SURFACE[roads.edge(n.edges[0]!).surface].color);
    const center = pos.length / 3;
    const y = n.y + LIFT + 0.01;
    pos.push(n.x, y, n.z);
    col.push(color.r, color.g, color.b);
    const SEG = 12;
    for (let k = 0; k <= SEG; k++) {
      const ang = (k / SEG) * Math.PI * 2;
      pos.push(n.x + Math.cos(ang) * widest * 0.75, y, n.z + Math.sin(ang) * widest * 0.75);
      col.push(color.r, color.g, color.b);
      if (k > 0) idx.push(center, center + k + 1, center + k);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
