import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { distanceToRoad } from '../world/placement';
import { mulberry32 } from '../world/random';
import type { RoadEdge, RoadNetwork } from '../world/roadNetwork';
import { merged, painted } from './details';

/**
 * Ausstattung am Hohen Kogel: Almhütte mit Kühen und Zaun auf der Kogelalm,
 * Gipfelkreuz und Biwakhütte oben, nummerierte Kehrenschilder an den Serpentinen.
 * Eigene Low-Poly-Entwürfe.
 */

const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Satteldach aus zwei schrägen Platten: Breite (x), Tiefe (z), Traufhöhe, Dachneigung. */
function gableRoof(w: number, d: number, eave: number, pitch: number, color: string, overhang = 0.6): THREE.BufferGeometry[] {
  const half = w / 2 + overhang;
  const slope = half / Math.cos(pitch);
  const rise = Math.tan(pitch) * half;
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(
      painted(
        new THREE.BoxGeometry(slope, 0.25, d + overhang * 2)
          .rotateZ(-side * pitch)
          .translate((side * half) / 2, eave + rise / 2, 0),
        color,
      ),
    );
  }
  return parts;
}

/** Giebeldreieck (Wandfarbe) über einer Breite w auf Höhe eave, Front bei z. */
function gable(w: number, eave: number, pitch: number, z: number, color: string): THREE.BufferGeometry {
  const rise = Math.tan(pitch) * (w / 2);
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  return painted(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }).translate(0, eave, z - 0.15), color);
}

/** Almhütte: Steinsockel, Holzwände, flaches Schindeldach, Balkon mit Blumen. Front = +z. */
function almHut(base: number): THREE.BufferGeometry {
  const W = 9;
  const D = 7;
  const wood = '#7a5232';
  const pitch = 0.42;
  const parts: THREE.BufferGeometry[] = [
    // Sockel reicht bis unter das Gelände (Hanglage)
    painted(new THREE.BoxGeometry(W + 0.4, base + 1.2, D + 0.4).translate(0, (1.2 - base) / 2, 0), '#a39c90'),
    painted(new THREE.BoxGeometry(W, 4.6, D).translate(0, 1.2 + 2.3, 0), wood),
    // Balken als dunklere Bänder
    ...[2.2, 3.8, 5.3].map((y) => painted(new THREE.BoxGeometry(W + 0.06, 0.12, D + 0.06).translate(0, y, 0), '#5e3e24')),
    gable(W, 5.8, pitch, D / 2, wood),
    gable(W, 5.8, pitch, -D / 2, wood),
    ...gableRoof(W, D, 5.8, pitch, '#5b4a3e', 0.9),
    painted(new THREE.BoxGeometry(0.4, 0.3, D + 1.9).translate(0, 5.8 + Math.tan(pitch) * (W / 2 + 0.9) + 0.05, 0), '#4a3b30'),
    // Kamin
    painted(new THREE.BoxGeometry(0.7, 2.2, 0.7).translate(2.2, 7.4, -1.2), '#a39c90'),
    // Tür und Fenster mit hellen Rahmen und roten Läden
    painted(new THREE.BoxGeometry(1.3, 2.3, 0.1).translate(-2.4, 2.35, D / 2 + 0.05), '#4a2f1c'),
    ...[[0.6, 2.5], [2.9, 2.5], [-2.4, 4.4], [0.6, 4.4], [2.9, 4.4]].flatMap(([x, y]) => [
      painted(new THREE.BoxGeometry(1.2, 1.1, 0.1).translate(x!, y!, D / 2 + 0.06), '#f2ead8'),
      painted(new THREE.BoxGeometry(0.9, 0.8, 0.1).translate(x!, y!, D / 2 + 0.1), '#4f6a86'),
      painted(new THREE.BoxGeometry(0.4, 1.1, 0.08).translate(x! - 0.85, y!, D / 2 + 0.08), '#b0412e'),
      painted(new THREE.BoxGeometry(0.4, 1.1, 0.08).translate(x! + 0.85, y!, D / 2 + 0.08), '#b0412e'),
    ]),
    // Balkon im Obergeschoss mit Geländer und Blumenkästen
    painted(new THREE.BoxGeometry(W + 0.6, 0.18, 1.4).translate(0, 3.55, D / 2 + 0.7), '#6b4a2e'),
    painted(new THREE.BoxGeometry(W + 0.6, 0.9, 0.1).translate(0, 4.1, D / 2 + 1.35), '#8a6440'),
    painted(new THREE.BoxGeometry(W + 0.4, 0.3, 0.3).translate(0, 4.7, D / 2 + 1.3), '#d8452f'),
    // Tisch und Bänke vor der Hütte
    painted(new THREE.BoxGeometry(2.2, 0.1, 0.9).translate(2, 0.85, D / 2 + 2.6), '#8a6440'),
    painted(new THREE.BoxGeometry(2.2, 0.1, 0.35).translate(2, 0.48, D / 2 + 1.8), '#8a6440'),
    painted(new THREE.BoxGeometry(2.2, 0.1, 0.35).translate(2, 0.48, D / 2 + 3.4), '#8a6440'),
    painted(new THREE.BoxGeometry(0.15, 0.85, 0.7).translate(1.1, 0.42, D / 2 + 2.6), '#6b4a2e'),
    painted(new THREE.BoxGeometry(0.15, 0.85, 0.7).translate(2.9, 0.42, D / 2 + 2.6), '#6b4a2e'),
    // Brunnentrog
    painted(new THREE.BoxGeometry(2, 0.6, 0.8).translate(-W / 2 - 1.4, 0.3, 1.5), '#7a5a3a'),
    painted(new THREE.BoxGeometry(1.8, 0.05, 0.6).translate(-W / 2 - 1.4, 0.56, 1.5), '#4f8fc6'),
  ];
  return merged(parts);
}

/** Kleine Biwakhütte aus Stein mit rotem Blechdach. Front = +z. */
function bivouac(base: number): THREE.BufferGeometry {
  const pitch = 0.6;
  return merged([
    painted(new THREE.BoxGeometry(5, 3 + base, 4).translate(0, (3 - base) / 2, 0), '#9d978c'),
    gable(5, 3, pitch, 2, '#9d978c'),
    gable(5, 3, pitch, -2, '#9d978c'),
    ...gableRoof(5, 4, 3, pitch, '#b03a2a', 0.35),
    painted(new THREE.BoxGeometry(1.1, 2, 0.1).translate(0, 1, 2.05), '#5b3a22'),
    painted(new THREE.BoxGeometry(0.8, 0.6, 0.1).translate(1.5, 1.9, 2.05), '#4f6a86'),
    // Bank an der Wand
    painted(new THREE.BoxGeometry(2, 0.1, 0.4).translate(-1.2, 0.45, 2.4), '#8a6440'),
  ]);
}

/** Gipfelkreuz aus Holz mit kleinem Dach auf einem Steinhaufen. */
function summitCross(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.DodecahedronGeometry(1.4, 0).scale(1.2, 0.6, 1.2).translate(0, 0.3, 0), '#8f897e'),
    painted(new THREE.DodecahedronGeometry(0.8, 0).scale(1, 0.7, 1).translate(0.6, 0.9, -0.3), '#a39c90'),
    painted(new THREE.BoxGeometry(0.32, 6, 0.32).translate(0, 3.6, 0), '#6b4a2e'),
    painted(new THREE.BoxGeometry(2.6, 0.3, 0.3).translate(0, 5.1, 0), '#6b4a2e'),
    painted(new THREE.ConeGeometry(0.45, 0.4, 4).rotateY(Math.PI / 4).translate(0, 6.8, 0), '#4a3b30'),
    painted(new THREE.BoxGeometry(0.5, 0.5, 0.05).translate(0, 4.4, 0.18), '#d8b84a'),
  ]);
}

/** Kuh: Körper, Kopf, Beine, Hörner; Flecken als zweite Farbe. Kopf = +z. */
function cow(patch: string): THREE.BufferGeometry {
  const legs = [[-0.35, -0.6], [0.35, -0.6], [-0.35, 0.6], [0.35, 0.6]].map(([x, z]) =>
    painted(new THREE.BoxGeometry(0.22, 0.75, 0.22).translate(x!, 0.37, z!), '#efe9df'),
  );
  return merged([
    painted(new THREE.BoxGeometry(0.95, 0.75, 1.75).translate(0, 1.1, 0), '#f2ede4'),
    painted(new THREE.BoxGeometry(0.97, 0.5, 0.7).translate(0, 1.2, -0.3), patch),
    painted(new THREE.BoxGeometry(0.5, 0.5, 0.6).translate(0, 1.35, 1.1), '#f2ede4'),
    painted(new THREE.BoxGeometry(0.42, 0.3, 0.25).translate(0, 1.22, 1.45), '#d9a59a'),
    painted(new THREE.BoxGeometry(0.75, 0.08, 0.08).translate(0, 1.66, 1.0), '#e8e0c8'),
    painted(new THREE.SphereGeometry(0.11, 6, 4).translate(0, 0.95, 1.38), '#c9a64a'),
    ...legs,
  ]);
}

// --- Kehren --------------------------------------------------------------------------------

export interface Hairpin {
  edge: RoadEdge;
  /** Strecke am Scheitel der Kehre. */
  s: number;
  x: number;
  y: number;
  z: number;
  /** Richtung nach außen (weg vom Kurveninneren), normiert. */
  outX: number;
  outZ: number;
}

/**
 * Findet Kehren entlang einer Kante: Stellen, an denen die Fahrtrichtung sich auf
 * kurzer Strecke um mehr als `minTurn` (Bogenmaß) dreht. Liefert den Scheitelpunkt.
 */
export function findHairpins(edge: RoadEdge, minTurn = 2.4, window = 30): Hairpin[] {
  const out: Hairpin[] = [];
  const heading = (s: number) => {
    const d = edge.directionAt(s);
    return Math.atan2(d.dz, d.dx);
  };
  const turnAt = (s: number) => {
    let a = heading(s + window) - heading(s - window);
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return Math.abs(a);
  };
  let s = window;
  while (s < edge.length - window) {
    if (turnAt(s) < minTurn) {
      s += 4;
      continue;
    }
    // Scheitel: Stelle mit der stärksten Drehung im Umkreis
    let best = s;
    let bestTurn = 0;
    for (let t = s; t < Math.min(edge.length - window, s + 2 * window); t += 2) {
      const v = turnAt(t);
      if (v > bestTurn) {
        bestTurn = v;
        best = t;
      }
    }
    const p = edge.pointAt(best);
    const a = edge.pointAt(Math.max(0, best - window));
    const b = edge.pointAt(Math.min(edge.length, best + window));
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const len = Math.hypot(p.x - cx, p.z - cz) || 1;
    out.push({ edge, s: best, ...p, outX: (p.x - cx) / len, outZ: (p.z - cz) / len });
    s = best + 2 * window;
  }
  return out;
}

/** Kehren einer Strecke (Folge von Kanten mit Richtung), von unten nach oben. */
function hairpinsAlong(roads: RoadNetwork, legs: [string, 1 | -1][]): Hairpin[] {
  const out: Hairpin[] = [];
  for (const [id, dir] of legs) {
    const e = roads.edges.get(id);
    if (!e) continue;
    const list = findHairpins(e);
    out.push(...(dir === 1 ? list : list.reverse()));
  }
  return out;
}

/** Schilder „Kehre n“ mit Höhe, als ein Texturatlas. */
function hairpinAtlas(labels: { n: number; h: number }[]): { tex: THREE.CanvasTexture; cols: number; rows: number } {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  const cw = 128;
  const ch = 160;
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const ctx = c.getContext('2d')!;
  labels.forEach((l, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.fillStyle = '#f6f3ea';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = '#2f5d8a';
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 6, y + 6, cw - 12, ch - 12);
    ctx.fillStyle = '#1f2f40';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('Kehre', x + cw / 2, y + 40);
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(String(l.n), x + cw / 2, y + 104);
    ctx.font = '24px sans-serif';
    ctx.fillText(`${Math.round(l.h)} m`, x + cw / 2, y + 140);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, cols, rows };
}

// --- Aufbau --------------------------------------------------------------------------------

export interface MountainDetails {
  group: THREE.Group;
  /** Flächen, die für Bäume und Häuser frei bleiben. */
  reserved: { x: number; z: number; r: number }[];
  hairpins: number;
}

/** Freie Stelle in Hanglage neben einem Punkt: Abstand zum Weg, Gefälle begrenzt. */
function slopeSpot(roads: RoadNetwork, terrain: Heightfield, x: number, z: number, minRoad: number, maxSlope: number) {
  for (let r = 14; r < 120; r += 4) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const pz = z + Math.sin(ang) * r;
      if (terrain.slope(px, pz) > maxSlope) continue;
      if (distanceToRoad(roads, px, pz, undefined, 60) < minRoad) continue;
      return { x: px, z: pz };
    }
  }
  return null;
}

/** Höchster und tiefster Geländepunkt unter einem Rechteck (für den Sockel). */
function footprintRange(terrain: Heightfield, x: number, z: number, rot: number, w: number, d: number) {
  let lo = Infinity;
  let hi = -Infinity;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const u of [-0.5, 0, 0.5]) {
    for (const v of [-0.5, 0, 0.5]) {
      const lx = u * w;
      const lz = v * d;
      const h = terrain.sample(x + lx * c + lz * s, z - lx * s + lz * c);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

const facing = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

export function createMountainDetails(terrain: Heightfield, roads: RoadNetwork, seed: number): MountainDetails {
  const group = new THREE.Group();
  group.name = 'kogel';
  const reserved: MountainDetails['reserved'] = [];
  const rng = mulberry32(seed ^ 0x6b6f67);

  const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rot: number, r: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat());
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    reserved.push({ x, z, r });
    return m;
  };

  // Kogelalm: Hütte mit Sockel in Hanglage, Front zum Weg, Kühe auf der Weide
  const alm = roads.nodes.get('kogelalm');
  if (alm) {
    const spot = slopeSpot(roads, terrain, alm.x, alm.z, 14, 0.3) ?? slopeSpot(roads, terrain, alm.x, alm.z, 14, 0.5);
    if (spot) {
      const rot = facing(spot.x, spot.z, alm.x, alm.z);
      // Bergseitig in den Hang gebaut, talseitig auf einem Sockel
      const { lo, hi } = footprintRange(terrain, spot.x, spot.z, rot, 10, 8);
      const y = lo + (hi - lo) * 0.55;
      place(almHut(y - lo + 0.5), spot.x, y, spot.z, rot, 12);
    }
    const cows: THREE.Matrix4[] = [];
    for (let k = 0; k < 60 && cows.length < 6; k++) {
      const ang = rng() * Math.PI * 2;
      const r = 30 + rng() * 70;
      const x = alm.x + Math.cos(ang) * r;
      const z = alm.z + Math.sin(ang) * r;
      if (distanceToRoad(roads, x, z, undefined, 40) < 10 || terrain.slope(x, z) > 0.6) continue;
      if (reserved.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 2)) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      cows.push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrain.sample(x, z) - 0.05, z), q, new THREE.Vector3(1, 1, 1)));
      reserved.push({ x, z, r: 2 });
    }
    for (const [i, patch] of ['#5a3a26', '#2e2a28'].entries()) {
      const list = cows.filter((_, k) => k % 2 === i);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(cow(patch), mat(), list.length);
      list.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = true;
      mesh.name = 'kuehe';
      group.add(mesh);
    }
  }

  // Gipfel: Kreuz am höchsten Punkt neben der Straße, Biwakhütte daneben
  const top = roads.nodes.get('gipfel');
  if (top) {
    let best = { x: top.x, z: top.z, h: -Infinity };
    for (let r = 12; r <= 60; r += 4) {
      for (let a = 0; a < 24; a++) {
        const x = top.x + Math.cos((a / 24) * Math.PI * 2) * r;
        const z = top.z + Math.sin((a / 24) * Math.PI * 2) * r;
        if (distanceToRoad(roads, x, z, undefined, 40) < 10) continue;
        const h = terrain.sample(x, z);
        if (h > best.h) best = { x, z, h };
      }
    }
    if (best.h > -Infinity) place(summitCross(), best.x, best.h - 0.2, best.z, facing(best.x, best.z, top.x, top.z), 4);
    const hut = slopeSpot(roads, terrain, top.x - 20, top.z + 10, 10, 0.35);
    if (hut) {
      const rot = facing(hut.x, hut.z, top.x, top.z);
      const { lo, hi } = footprintRange(terrain, hut.x, hut.z, rot, 5, 4);
      const y = lo + (hi - lo) * 0.55;
      place(bivouac(y - lo + 0.3), hut.x, y, hut.z, rot, 6);
    }
  }

  // Kehrenschilder: gezählt von unten nach oben herunter bis 1 am Gipfel (wie an Alpenpässen)
  const climbs = [
    hairpinsAlong(roads, [['kogelstrasse', 1], ['gipfelstrasse', 1]]),
    hairpinsAlong(roads, [['westrampe', 1]]),
  ];
  const labels: { n: number; h: number }[] = [];
  const signs: Hairpin[] = [];
  for (const list of climbs) {
    list.forEach((hp, i) => {
      labels.push({ n: list.length - i, h: hp.y });
      signs.push(hp);
    });
  }
  if (signs.length > 0) {
    const { tex, cols, rows } = hairpinAtlas(labels);
    const boards: THREE.BufferGeometry[] = [];
    const poles: THREE.BufferGeometry[] = [];
    signs.forEach((hp, i) => {
      // Am Außenrand der Kehre, Schild schaut zur Kurvenmitte (zur Fahrbahn)
      const x = hp.x + hp.outX * 6.5;
      const z = hp.z + hp.outZ * 6.5;
      const y = Math.max(terrain.sample(x, z), hp.y - 0.5);
      const rot = Math.atan2(-hp.outX, -hp.outZ);
      const board = new THREE.PlaneGeometry(0.9, 1.125);
      const uv = board.attributes.uv!;
      const u0 = (i % cols) / cols;
      const v0 = 1 - (Math.floor(i / cols) + 1) / rows;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / cols, v0 + uv.getY(k) / rows);
      boards.push(board.rotateY(rot).translate(x, y + 1.9, z));
      poles.push(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5).translate(x, y + 0.8, z));
    });
    const boardMesh = new THREE.Mesh(merged(boards), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    boardMesh.name = 'kehrenschilder';
    const poleMesh = new THREE.Mesh(merged(poles), new THREE.MeshLambertMaterial({ color: '#6c6c6c' }));
    group.add(boardMesh, poleMesh);
  }

  return { group, reserved, hairpins: signs.length };
}
