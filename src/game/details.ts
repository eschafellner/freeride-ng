import * as THREE from 'three';
import { DynamicLod, lod, LodInstances, type LodItem } from './lod';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';
import { REBLAND, roadside, vineyardRows, type Placement } from '../world/placement';
import type { RoadNetwork } from '../world/roadNetwork';
import { townMask } from '../world/terrainGen';

/** Färbt eine Geometrie einheitlich (für zusammengeführte Low-Poly-Modelle). */
export function painted(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

const material = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });


const toItem = (p: Placement): LodItem => ({
  matrix: new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
    new THREE.Vector3(1, 1, 1),
  ),
});

/** Kleinteile am Weg in Kacheln, ab `hide` Metern ausgeblendet. */
function chunked(name: string, geo: THREE.BufferGeometry, items: Placement[], hide: number, castShadow: boolean): THREE.Group {
  if (items.length === 0) return new THREE.Group();
  return lod.add(new LodInstances({ name, near: geo, material: material(), nearDist: hide, hideDist: hide, castShadow, cell: 250 },
    items.map((p) => toItem(p)))).group;
}

// --- Modelle -------------------------------------------------------------------------

function lampGeometry(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6).translate(0, 2.1, 0), '#3b3f45'),
    painted(new THREE.BoxGeometry(0.08, 0.08, 1.0).translate(0, 4.15, -0.45), '#3b3f45'),
    painted(new THREE.BoxGeometry(0.35, 0.18, 0.5).translate(0, 4.05, -0.9), '#fff2c4'),
  ]);
}

function delineatorGeometry(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0), '#f4f4f4'),
    painted(new THREE.BoxGeometry(0.13, 0.22, 0.13).translate(0, 0.78, 0), '#1f1f1f'),
  ]);
}

/** Ein Zaunfeld von 3 m entlang der lokalen z-Achse. */
function fenceGeometry(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, -1.5), '#8a6a45'),
    painted(new THREE.BoxGeometry(0.06, 0.1, 3).translate(0, 0.85, 0), '#a07b52'),
    painted(new THREE.BoxGeometry(0.06, 0.1, 3).translate(0, 0.45, 0), '#a07b52'),
  ]);
}

/** Ein Rebstock-Abschnitt von 5 m: Pfahl plus grüne Laubwand. */
function vineGeometry(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.BoxGeometry(0.08, 1.5, 0.08).translate(0, 0.75, -2.5), '#7a5b3a'),
    painted(new THREE.BoxGeometry(0.5, 0.9, 5).translate(0, 0.95, 0), '#4f8a2f'),
    painted(new THREE.BoxGeometry(0.42, 0.25, 5).translate(0, 1.5, 0), '#5f9a36'),
  ]);
}

function vineFarGeometry(): THREE.BufferGeometry {
  return painted(new THREE.BoxGeometry(0.5, 1.2, 5).translate(0, 1.0, 0), '#55902f');
}

// --- Aufbau ---------------------------------------------------------------------------

export function createDetails(terrain: Heightfield, roads: RoadNetwork, seed: number): THREE.Group {
  const group = new THREE.Group();
  const inTown = (x: number, z: number) => townMask(x, z) > 0.6;
  const inRebland = (x: number, z: number) => Math.hypot(x - REBLAND.x, z - REBLAND.z) < REBLAND.radius;

  // Laternen in der Stadt, abwechselnd links und rechts, vorn am Gehsteig
  // (Bordstein bei 3,25 m von der Wegmitte, Mast 0,4 m dahinter)
  const lamps = roadside(terrain, roads, {
    spacing: 28, offset: 3.65, sides: [1, -1], staggered: true,
    edgeFilter: (e) => e.surface === 'town',
    pointFilter: inTown,
  });
  // Laterne zur Straße drehen: Arm zeigt Richtung Fahrbahn
  group.add(chunked('laternen', lampGeometry(), lamps.map((p, i) => ({ ...p, rot: p.rot + (i % 2 ? Math.PI / 2 : -Math.PI / 2) })), 700, true));

  // Leitpfosten auf Landstraßen
  const posts = roadside(terrain, roads, {
    spacing: 50, offset: 3.4, sides: [1, -1],
    edgeFilter: (e) => e.surface === 'asphalt',
    pointFilter: (x, z) => !inTown(x, z),
  });
  group.add(chunked('leitpfosten', delineatorGeometry(), posts, 350, false));

  // Holzzäune im Rebland, einseitig, mit Lücken
  const fences = roadside(terrain, roads, {
    spacing: 3, offset: 5.5, sides: [1],
    edgeFilter: (e) => e.surface !== 'town',
    pointFilter: (x, z) => inRebland(x, z) && Math.sin(x / 70) * Math.cos(z / 55) > 0.1,
  });
  group.add(chunked('zaun', fenceGeometry(), fences.map((p) => ({ ...p, y: p.y - 0.05 })), 500, false));

  // Weinberge: jede Zeile in 5-m-Abschnitte, die dem Gelände folgen
  const vines: Placement[] = [];
  for (const r of vineyardRows(terrain, roads, seed)) {
    const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const rot = Math.atan2(r.x2 - r.x1, r.z2 - r.z1);
    for (let s = 2.5; s < len; s += 5) {
      const t = s / len;
      const x = r.x1 + (r.x2 - r.x1) * t;
      const z = r.z1 + (r.z2 - r.z1) * t;
      vines.push({ x, y: terrain.sample(x, z) - 0.05, z, rot });
    }
  }
  // Reben: nah mit Pfählen und Laub, in der Ferne nur ein grüner Streifen
  group.add(lod.add(new DynamicLod({
    name: 'reben', near: vineGeometry(), far: vineFarGeometry(), material: material(),
    nearDist: 250, hideDist: 1500, castShadow: true, farShadow: false,
  }, vines.map((p) => toItem(p)))).group);

  group.userData.counts = { lamps: lamps.length, posts: posts.length, fences: fences.length, vines: vines.length };
  return group;
}
