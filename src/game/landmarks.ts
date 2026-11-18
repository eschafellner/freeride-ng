import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad } from '../world/placement';
import type { RoadNetwork } from '../world/roadNetwork';
import { merged, painted } from './details';

/**
 * Wahrzeichen: Kirche am Marktplatz, Kapelle auf dem Hügel, Hafen mit Molen,
 * Booten und Leuchtfeuer. Eigene Low-Poly-Entwürfe.
 */

const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function church(): THREE.BufferGeometry {
  return merged([
    // Kirchenschiff
    painted(new THREE.BoxGeometry(10, 8, 20).translate(0, 4, 0), '#efe8da'),
    painted(new THREE.ConeGeometry(8.2, 5, 4).rotateY(Math.PI / 4).scale(0.9, 1, 1.75).translate(0, 10.5, 0), '#8f4433'),
    // Turm mit spitzem Helm
    painted(new THREE.BoxGeometry(5, 20, 5).translate(0, 10, 12), '#e9e1d0'),
    painted(new THREE.ConeGeometry(3.9, 9, 4).rotateY(Math.PI / 4).translate(0, 24.5, 12), '#4f6f5a'),
    painted(new THREE.BoxGeometry(0.2, 2.2, 0.2).translate(0, 30, 12), '#c9a64a'),
    painted(new THREE.BoxGeometry(1.4, 0.2, 0.2).translate(0, 30.4, 12), '#c9a64a'),
    // Uhr und Schallfenster
    painted(new THREE.CylinderGeometry(1.1, 1.1, 0.15, 12).rotateX(Math.PI / 2).translate(0, 16, 14.55), '#f7f2e4'),
    painted(new THREE.BoxGeometry(1.2, 2, 0.1).translate(0, 18.5, 14.55), '#3a3a3a'),
    // Portal und Fenster
    painted(new THREE.BoxGeometry(2.2, 3.4, 0.1).translate(0, 1.7, 14.55), '#6b4226'),
    ...[-6, 0, 6].flatMap((z) => [
      painted(new THREE.BoxGeometry(0.1, 3.2, 1.4).translate(5.05, 4.5, z), '#5a6f8f'),
      painted(new THREE.BoxGeometry(0.1, 3.2, 1.4).translate(-5.05, 4.5, z), '#5a6f8f'),
    ]),
  ]);
}

function chapel(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.BoxGeometry(6, 5, 9).translate(0, 2.5, 0), '#f3eee2'),
    painted(new THREE.ConeGeometry(5.2, 3.2, 4).rotateY(Math.PI / 4).scale(0.85, 1, 1.35).translate(0, 6.6, 0), '#7e3b2e'),
    // Dachreiter mit Glocke
    painted(new THREE.BoxGeometry(1.6, 2.4, 1.6).translate(0, 8.4, 3.2), '#f3eee2'),
    painted(new THREE.ConeGeometry(1.4, 2.6, 4).rotateY(Math.PI / 4).translate(0, 10.9, 3.2), '#4f6f5a'),
    painted(new THREE.BoxGeometry(0.15, 1.2, 0.15).translate(0, 12.6, 3.2), '#c9a64a'),
    painted(new THREE.BoxGeometry(0.8, 0.15, 0.15).translate(0, 12.8, 3.2), '#c9a64a'),
    painted(new THREE.BoxGeometry(1.5, 2.6, 0.1).translate(0, 1.3, 4.55), '#6b4226'),
    painted(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 10).rotateX(Math.PI / 2).translate(0, 3.9, 4.56), '#5a6f8f'),
  ]);
}

function fountain(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.CylinderGeometry(3, 3.2, 0.8, 10).translate(0, 0.4, 0), '#b8b0a2'),
    painted(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 10).translate(0, 0.75, 0), '#4f8fc6'),
    painted(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 8).translate(0, 1.5, 0), '#b8b0a2'),
    painted(new THREE.CylinderGeometry(1.1, 0.5, 0.4, 8).translate(0, 2.6, 0), '#b8b0a2'),
  ]);
}

export function boat(color: string): THREE.BufferGeometry {
  return merged([
    painted(new THREE.BoxGeometry(2.4, 1.0, 7).translate(0, 0.2, 0), color),
    painted(new THREE.ConeGeometry(1.7, 2.4, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.2, 4.7), color),
    painted(new THREE.BoxGeometry(2.0, 0.1, 6.6).translate(0, 0.72, 0.3), '#c9a77a'),
    painted(new THREE.BoxGeometry(1.6, 1.2, 1.8).translate(0, 1.35, -1.6), '#f4f1ea'),
    painted(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 5).translate(0, 3, 0.8), '#7a5a3a'),
  ]);
}

function lighthouse(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(
      painted(
        new THREE.CylinderGeometry(1.45 - i * 0.15, 1.6 - i * 0.15, 2.5, 10).translate(0, 1.25 + i * 2.5, 0),
        i % 2 ? '#d33a2c' : '#f6f3ec',
      ),
    );
  }
  parts.push(
    painted(new THREE.CylinderGeometry(1.4, 1.4, 0.25, 10).translate(0, 10.1, 0), '#3a3a3a'),
    painted(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 8).translate(0, 10.9, 0), '#ffe9a3'),
    painted(new THREE.ConeGeometry(1.0, 1.1, 8).translate(0, 12.1, 0), '#d33a2c'),
  );
  return merged(parts);
}

/** Eine Mole als Folge von Steinblöcken vom Ufer ins Meer. */
function pier(fromX: number, fromZ: number, dirX: number, dirZ: number, length: number): THREE.InstancedMesh {
  const n = Math.ceil(length / 4);
  const geo = painted(new THREE.BoxGeometry(5, 3, 4.2), '#a49d90');
  const mesh = new THREE.InstancedMesh(geo, mat(), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dirX, dirZ));
  for (let i = 0; i < n; i++) {
    m.compose(new THREE.Vector3(fromX + dirX * i * 4, 0.3, fromZ + dirZ * i * 4), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Freie Stelle neben einem Knoten suchen (nicht auf Wegen). */
function spotNear(roads: RoadNetwork, terrain: Heightfield, x: number, z: number, minRoadDist: number) {
  for (let r = 18; r < 90; r += 6) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const pz = z + Math.sin(ang) * r;
      if (distanceToRoad(roads, px, pz, undefined, 60) >= minRoadDist && terrain.slope(px, pz) < 0.15) {
        return { x: px, z: pz, y: terrain.sample(px, pz) };
      }
    }
  }
  return null;
}

/** Drehung, damit die Vorderseite (+z) zu einem Punkt zeigt. */
const facing = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

export interface Landmarks {
  group: THREE.Group;
  /** Flächen, die für andere Objekte frei bleiben. */
  reserved: { x: number; z: number; r: number }[];
  animate(dt: number): void;
}

export function createLandmarks(terrain: Heightfield, roads: RoadNetwork): Landmarks {
  const group = new THREE.Group();
  const reserved: Landmarks['reserved'] = [];
  const boats: { mesh: THREE.Mesh; phase: number; baseY: number }[] = [];

  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rot: number, r: number) => {
    const m = new THREE.Mesh(geo, mat());
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    reserved.push({ x, z, r });
    return m;
  };

  // Kirche am Marktplatz, Portal zum Platz
  const markt = roads.nodes.get('markt');
  if (markt) {
    const spot = spotNear(roads, terrain, markt.x, markt.z - 10, 18);
    if (spot) add(church(), spot.x, spot.y - 0.4, spot.z, facing(spot.x, spot.z, markt.x, markt.z), 18);
    const f = spotNear(roads, terrain, markt.x + 8, markt.z + 8, 7);
    if (f) add(fountain(), f.x, f.y - 0.1, f.z, 0, 5);
  }

  // Kapelle auf dem Hügel, Eingang zum Weg
  const kapelle = roads.nodes.get('kapelle');
  if (kapelle) {
    const spot = spotNear(roads, terrain, kapelle.x, kapelle.z, 11);
    if (spot) add(chapel(), spot.x, spot.y - 0.3, spot.z, facing(spot.x, spot.z, kapelle.x, kapelle.z), 9);
  }

  // Hafen: zwei Molen ins Meer, Leuchtfeuer am Ende der östlichen, Boote dazwischen
  const hafen = roads.nodes.get('hafen');
  if (hafen) {
    // Ufer südlich des Hafenplatzes suchen
    let shoreZ = hafen.z;
    while (terrain.sample(hafen.x, shoreZ) > 0.5 && shoreZ < hafen.z + 300) shoreZ += 2;
    const west = { x: hafen.x - 70, z: shoreZ - 12 };
    const east = { x: hafen.x + 70, z: shoreZ - 12 };
    group.add(pier(west.x, west.z, 0.25, 1, 110));
    group.add(pier(east.x, east.z, -0.25, 1, 110));
    const tipX = east.x - 0.25 * 108;
    const tipZ = east.z + 108;
    add(lighthouse(), tipX, 1.6, tipZ, 0, 4);

    const colors = ['#2f6fb0', '#c4452f', '#2f8f6f', '#e0b23a', '#f4f1ea'];
    for (let i = 0; i < 6; i++) {
      const x = hafen.x - 40 + i * 16;
      const z = shoreZ + 25 + (i % 2) * 18;
      const m = new THREE.Mesh(boat(colors[i % colors.length]!), mat());
      m.position.set(x, 0, z);
      m.rotation.y = 0.2 * (i % 3) - 0.2;
      m.castShadow = true;
      group.add(m);
      boats.push({ mesh: m, phase: i * 1.3, baseY: 0 });
    }
  }

  let t = 0;
  return {
    group,
    reserved,
    animate(dt: number) {
      t += dt;
      for (const b of boats) {
        b.mesh.position.y = b.baseY + Math.sin(t * 1.1 + b.phase) * 0.15;
        b.mesh.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04;
      }
    },
  };
}
