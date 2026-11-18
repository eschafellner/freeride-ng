import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad } from '../world/placement';
import { mulberry32 } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { COVES, coveBeach } from '../world/terrainGen';
import { merged, painted } from './details';
import { NIGHT_GLOW } from './houses';
import { boat } from './landmarks';

/**
 * Ausstattung am Nordkap: Leuchtturm mit Wärterhaus auf dem Kap (nachts mit kreisendem
 * Lichtstrahl), Fischerboote und ein Steg in der Kapbucht, Robben in der Robbenbucht und
 * Möwen über den Klippen. Eigene Low-Poly-Entwürfe.
 */

const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const facing = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

/** Höhe des Lichts über dem Fuß des Turms (m). */
export const LIGHTHOUSE_LIGHT_Y = 21.6;

/** Leuchtturm: weiß mit roten Bändern, Galerie, Laterne (eigenes Mesh) und rote Haube. */
function lighthouseTower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    // Sockel aus Bruchstein, reicht ins Gelände
    painted(new THREE.CylinderGeometry(3.6, 4.0, 3, 10).translate(0, 0, 0), '#8f877c'),
  ];
  // Schaft in sechs Abschnitten, nach oben schlanker
  for (let i = 0; i < 6; i++) {
    const r0 = 3.0 - i * 0.22;
    parts.push(painted(new THREE.CylinderGeometry(r0 - 0.22, r0, 3, 10).translate(0, 1.5 + 1.5 + i * 3, 0), i % 2 ? '#c8352a' : '#f4f1ea'));
  }
  // Fenster am Schaft (dunkle Schlitze)
  for (const [y, a] of [[5.5, 0.4], [9.8, 2.6], [14.2, 4.8]] as const) {
    parts.push(painted(new THREE.BoxGeometry(0.5, 1.1, 0.3).translate(0, y, 2.55 - y * 0.075).rotateY(a), '#3a4450'));
  }
  // Tür
  parts.push(painted(new THREE.BoxGeometry(1.2, 2.1, 0.3).translate(0, 2.6, 3.0), '#2f5a7a'));
  // Galerie mit Geländer
  parts.push(painted(new THREE.CylinderGeometry(2.4, 2.1, 0.35, 12).translate(0, 19.3, 0), '#3a3a3a'));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    parts.push(painted(new THREE.BoxGeometry(0.08, 0.9, 0.08).translate(Math.cos(a) * 2.3, 19.9, Math.sin(a) * 2.3), '#2e2e2e'));
  }
  parts.push(painted(new THREE.TorusGeometry(2.3, 0.05, 4, 16).rotateX(Math.PI / 2).translate(0, 20.35, 0), '#2e2e2e'));
  // Laternenrahmen und Haube
  parts.push(
    painted(new THREE.CylinderGeometry(1.45, 1.45, 0.25, 10).translate(0, 20.5, 0), '#2e2e2e'),
    painted(new THREE.CylinderGeometry(1.5, 1.5, 0.25, 10).translate(0, 22.75, 0), '#2e2e2e'),
    painted(new THREE.ConeGeometry(1.75, 1.6, 10).translate(0, 23.65, 0), '#c8352a'),
    painted(new THREE.SphereGeometry(0.25, 6, 4).translate(0, 24.55, 0), '#2e2e2e'),
  );
  return merged(parts);
}

/** Wärterhaus: weiß, rotes Satteldach, Front = +z. */
function keeperHouse(base: number): THREE.BufferGeometry {
  const W = 8;
  const D = 6;
  const pitch = 0.6;
  const rise = Math.tan(pitch) * (W / 2 + 0.4);
  const roofLen = (W / 2 + 0.4) / Math.cos(pitch);
  const gable = (z: number) => {
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, Math.tan(pitch) * (W / 2))]);
    return painted(new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }).translate(0, 3.6, z - 0.1), '#f2efe6');
  };
  const parts: THREE.BufferGeometry[] = [
    painted(new THREE.BoxGeometry(W + 0.3, base + 0.6, D + 0.3).translate(0, (0.6 - base) / 2, 0), '#8f877c'),
    painted(new THREE.BoxGeometry(W, 3.0, D).translate(0, 0.6 + 1.5, 0), '#f2efe6'),
    gable(D / 2),
    gable(-D / 2),
    painted(new THREE.BoxGeometry(roofLen, 0.22, D + 0.8).rotateZ(-pitch).translate((W / 2 + 0.4) / 2, 3.6 + rise / 2, 0), '#b8402f'),
    painted(new THREE.BoxGeometry(roofLen, 0.22, D + 0.8).rotateZ(pitch).translate(-(W / 2 + 0.4) / 2, 3.6 + rise / 2, 0), '#b8402f'),
    painted(new THREE.BoxGeometry(0.7, 1.8, 0.7).translate(2.2, 5.6, -1), '#8f877c'),
    painted(new THREE.BoxGeometry(1.1, 2.0, 0.15).translate(-1.6, 1.6, D / 2 + 0.05), '#2f5a7a'),
  ];
  for (const x of [0.6, 2.6]) parts.push(painted(new THREE.BoxGeometry(1.0, 1.1, 0.15).translate(x, 2.3, D / 2 + 0.05), '#3a4450'));
  for (const x of [-2.2, 1.6]) parts.push(painted(new THREE.BoxGeometry(1.0, 1.1, 0.15).translate(x, 2.3, -D / 2 - 0.05), '#3a4450'));
  return merged(parts);
}

/** Holzsteg auf Pfählen, von (0,0) nach +z, Länge len. */
function jetty(len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [painted(new THREE.BoxGeometry(2.2, 0.2, len).translate(0, 1.2, len / 2), '#8a6a48')];
  for (let z = 1; z < len; z += 4) {
    for (const x of [-1, 1]) parts.push(painted(new THREE.CylinderGeometry(0.14, 0.14, 4, 5).translate(x, -0.8, z), '#5e4630'));
  }
  return merged(parts);
}

/** Robbe: liegender, grauer Körper mit Kopf. Kopf = +z. */
function seal(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.SphereGeometry(0.55, 7, 5).scale(1, 0.7, 2.1).translate(0, 0.38, 0), '#7c7f86'),
    painted(new THREE.SphereGeometry(0.3, 6, 4).translate(0, 0.62, 1.2), '#868990'),
    painted(new THREE.ConeGeometry(0.35, 0.6, 4).rotateX(-Math.PI / 2).scale(1.4, 0.4, 1).translate(0, 0.22, -1.35), '#6b6e74'),
  ]);
}

/** Möwe: flaches V mit kleinem Körper, Flügel entlang x. */
function gull(): THREE.BufferGeometry {
  const wing = (side: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, side * 0.9, 0.25, -0.05, 0, 0, -0.25], 3));
    g.computeVertexNormals();
    return painted(g, '#f4f4f2');
  };
  return merged([
    wing(1), wing(-1),
    painted(new THREE.BoxGeometry(0.16, 0.14, 0.7), '#eeeeea'),
  ]);
}

export interface NordkapDetails {
  group: THREE.Group;
  reserved: { x: number; z: number; r: number }[];
  animate(dt: number): void;
}

export function createNordkapDetails(terrain: Heightfield, roads: RoadNetwork, seed: number): NordkapDetails {
  const group = new THREE.Group();
  group.name = 'nordkap';
  const reserved: { x: number; z: number; r: number }[] = [];
  const rng = mulberry32(seed ^ 0x6b1d);
  const animations: ((t: number) => void)[] = [];

  const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rot: number, r: number) => {
    const m = new THREE.Mesh(geo, mat());
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    reserved.push({ x, z, r });
    return m;
  };

  // --- Leuchtturm auf dem Kap ------------------------------------------------------------
  const tip = roads.nodes.get('leuchtturm');
  if (tip) {
    // Weiter draußen als das Wegende, mit festem Grund (nicht an der Klippenkante)
    let best: { x: number; z: number; y: number; score: number } | null = null;
    for (let r = 14; r <= 46; r += 4) {
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2;
        const x = tip.x + Math.cos(ang) * r;
        const z = tip.z + Math.sin(ang) * r;
        if (distanceToRoad(roads, x, z, undefined, 30) < 9) continue;
        let solid = true;
        for (let k = 0; k < 8 && solid; k++) {
          const b = (k / 8) * Math.PI * 2;
          if (terrain.sample(x + Math.cos(b) * 9, z + Math.sin(b) * 9) < tip.y - 12) solid = false;
        }
        if (!solid || terrain.slope(x, z) > 0.35) continue;
        const score = -z; // möglichst weit im Norden
        if (!best || score > best.score) best = { x, z, y: terrain.sample(x, z), score };
      }
    }
    if (best) {
      const tower = place(lighthouseTower(), best.x, best.y - 0.3, best.z, 0, 6);
      tower.name = 'leuchtturm';
      // Laterne: leuchtet nachts warm
      const lampMat = new THREE.MeshLambertMaterial({ color: '#fff4cf', emissive: '#ffd27a', emissiveIntensity: 0.15 });
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.0, 10), lampMat);
      lamp.position.set(best.x, best.y - 0.3 + LIGHTHOUSE_LIGHT_Y, best.z);
      group.add(lamp);
      // Zwei gegenüberliegende Lichtstrahlen, die langsam kreisen (nur nachts sichtbar)
      const beamMat = new THREE.MeshBasicMaterial({
        color: '#ffe7a8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const beamGeo = new THREE.ConeGeometry(9, 160, 12, 1, true).rotateZ(Math.PI / 2).translate(80, 0, 0);
      const beams = new THREE.Group();
      beams.position.copy(lamp.position);
      beams.add(new THREE.Mesh(beamGeo, beamMat), new THREE.Mesh(beamGeo, beamMat).rotateY(Math.PI));
      beams.visible = false;
      beams.name = 'lichtstrahl';
      group.add(beams);
      animations.push((t) => {
        const night = NIGHT_GLOW.value;
        lampMat.emissiveIntensity = 0.15 + 1.6 * night;
        beamMat.opacity = 0.16 * night;
        beams.visible = night > 0.02;
        beams.rotation.y = t * 0.55;
      });

      // Wärterhaus daneben, Front zur Straße
      const hx = best.x + (tip.x - best.x) * 0.35 + (rng() < 0.5 ? -1 : 1) * 13;
      const hz = best.z + (tip.z - best.z) * 0.35;
      if (distanceToRoad(roads, hx, hz, undefined, 30) > 8) {
        const rot = facing(hx, hz, tip.x, tip.z);
        let lo = Infinity;
        for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3], [0, 0]]) lo = Math.min(lo, terrain.sample(hx + dx!, hz + dz!));
        const y = terrain.sample(hx, hz);
        place(keeperHouse(y - lo + 0.4), hx, y, hz, rot, 8);
      }
    }
  }

  // --- Kapbucht: Steg mit Fischerbooten, Boote am Strand -----------------------------------
  const boats: { mesh: THREE.Mesh; phase: number }[] = [];
  const kapbucht = COVES.find((c) => c.id === 'kapbucht');
  if (kapbucht) {
    const [bx, bz] = coveBeach(kapbucht);
    // Uferlinie nördlich des Strands suchen
    let sz = bz;
    while (terrain.sample(bx, sz) > 0.3 && sz > bz - 150) sz -= 1;
    const jet = new THREE.Mesh(jetty(34), mat());
    jet.position.set(bx + 6, 0, sz + 6);
    jet.rotation.y = Math.PI; // ins Meer nach Norden
    jet.receiveShadow = true;
    group.add(jet);
    const colors = ['#2f6fb0', '#c4452f', '#e0b23a'];
    colors.forEach((c, i) => {
      const m = new THREE.Mesh(boat(c), mat());
      m.position.set(bx + (i % 2 ? 1 : 11), 0, sz - 8 - i * 9);
      m.rotation.y = Math.PI + 0.15 * (i - 1);
      m.castShadow = true;
      group.add(m);
      boats.push({ mesh: m, phase: i * 1.7 });
    });
    // Zwei Boote auf den Strand gezogen
    for (const [dx, rot] of [[-14, 2.6], [-22, 2.9]] as const) {
      const x = bx + dx;
      const z = sz + 9;
      const y = terrain.sample(x, z);
      if (y > 0.2 && y < 4) {
        const m = new THREE.Mesh(boat(dx < -16 ? '#2f8f6f' : '#f4f1ea'), mat());
        m.position.set(x, y + 0.25, z);
        m.rotation.set(0.05, rot, 0.12);
        m.castShadow = true;
        group.add(m);
      }
    }
  }

  // --- Robbenbucht: Robben am Strand -------------------------------------------------------
  const robben = COVES.find((c) => c.id === 'robbenbucht');
  if (robben) {
    const [bx, bz] = coveBeach(robben);
    const sealGeo = seal();
    const list: THREE.Matrix4[] = [];
    for (let k = 0; k < 40 && list.length < 7; k++) {
      const x = bx + (rng() - 0.5) * 50;
      const z = bz + (rng() - 0.5) * 30;
      const y = terrain.sample(x, z);
      if (y < 0.4 || y > 3.5) continue;
      if (list.some((m) => new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3(x, y, z)) < 2.5)) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.05, z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng() * 0.4)));
    }
    if (list.length) {
      const mesh = new THREE.InstancedMesh(sealGeo, mat(), list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.name = 'robben';
      group.add(mesh);
    }
  }

  // --- Möwen über den Klippen --------------------------------------------------------------
  const flocks: { x: number; z: number; y: number }[] = [];
  if (tip) flocks.push({ x: tip.x, z: tip.z - 30, y: tip.y + 18 });
  for (const c of COVES) {
    const [bx, bz] = coveBeach(c);
    flocks.push({ x: bx, z: bz - 20, y: Math.max(25, terrain.sample(bx, bz + 120) - 10) });
  }
  const gulls = flocks.flatMap((f) =>
    Array.from({ length: 5 }, () => ({
      ...f, r: 18 + rng() * 40, h: (rng() - 0.3) * 20, speed: (0.25 + rng() * 0.25) * (rng() < 0.5 ? -1 : 1), phase: rng() * Math.PI * 2, flap: 4 + rng() * 3,
    })),
  );
  const gullMesh = new THREE.InstancedMesh(gull(), mat(), gulls.length);
  gullMesh.name = 'moewen';
  gullMesh.frustumCulled = false;
  group.add(gullMesh);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  animations.push((t) => {
    gulls.forEach((g, i) => {
      const a = g.phase + t * g.speed;
      pos.set(g.x + Math.cos(a) * g.r, g.y + g.h + Math.sin(t * 0.4 + g.phase) * 3, g.z + Math.sin(a) * g.r);
      // Blickrichtung tangential zur Kreisbahn
      q.setFromAxisAngle(up, -a + (g.speed > 0 ? Math.PI : 0));
      scl.set(1.6, 1.6 * (0.4 + 0.6 * Math.abs(Math.sin(t * g.flap + g.phase))), 1.6);
      gullMesh.setMatrixAt(i, m4.compose(pos, q, scl));
    });
    gullMesh.instanceMatrix.needsUpdate = true;
    for (const b of boats) {
      b.mesh.position.y = Math.sin(t * 1.1 + b.phase) * 0.15;
      b.mesh.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04;
    }
  });

  let t = 0;
  return {
    group,
    reserved,
    animate(dt: number) {
      t += dt;
      for (const f of animations) f(t);
    },
  };
}
