import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';
import { waterLevelAt } from '../world/lakes';
import type { RoadEdge, RoadNetwork } from '../world/roadNetwork';
import { part, sharedHouseMaterial, SURF, type Surf } from './houses';

/** Halbe Breite der Brückenplatte (Fahrbahn 6 m plus Gehweg/Kante). */
const DECK_HALF = 4.2;
const DECK_THICK = 1.1;
/** Abstand der Pfeiler in m. */
const PIER_SPACING = 42;

/**
 * Brücken aus Stein: Fahrbahnplatte mit Gesims, Geländer, Pfeiler bis zum
 * Meeresgrund mit Eisbrechern und Widerlager an den Ufern. Ein Mesh je Brücke.
 */
export function createBridges(roads: RoadNetwork, terrain: Heightfield): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bruecken';
  for (const e of roads.edges.values()) {
    if (e.surface !== 'bridge') continue;
    const parts = isLakeBridge(e) ? woodenBridgeParts(e, terrain) : bridgeParts(e, terrain);
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, sharedHouseMaterial());
    mesh.name = `bruecke-${e.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Wasserspiegel unter der Brückenmitte (0 = Meer). */
function waterUnder(e: RoadEdge): number {
  const m = e.pointAt(e.length / 2);
  return waterLevelAt(m.x, m.z);
}

/** Brücken über die Bergseen sind aus Holz (Fahrbahn aus Bohlen, ohne Markierung). */
export function isLakeBridge(e: RoadEdge): boolean {
  return e.surface === 'bridge' && waterUnder(e) > 0;
}

/** Ein Quader entlang des Weges zwischen s0 und s1, seitlich versetzt. */
function along(e: RoadEdge, s0: number, s1: number, lateral: number, w: number, y0: number, y1: number, color: string, surf: Surf): THREE.BufferGeometry {
  const a = e.pointAt(s0);
  const b = e.pointAt(s1);
  const d = e.directionAt((s0 + s1) / 2);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const px = -d.dz;
  const pz = d.dx;
  const cx = (a.x + b.x) / 2 + px * lateral;
  const cz = (a.z + b.z) / 2 + pz * lateral;
  const midY = (a.y + b.y) / 2;
  const g = new THREE.BoxGeometry(w, y1 - y0, len + 0.05);
  // Neigung entlang des Weges, dann Drehung in Fahrtrichtung
  g.rotateX(-Math.atan2(b.y - a.y, len));
  g.rotateY(Math.atan2(d.dx, d.dz));
  g.translate(cx, midY + (y0 + y1) / 2, cz);
  return part(g, color, 0, surf, midY + y1);
}

function bridgeParts(e: RoadEdge, terrain: Heightfield): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const step = 4;
  const stone = '#c2b8a6';
  const dark = '#8f877a';
  for (let s = 0; s < e.length; s += step) {
    const s1 = Math.min(e.length, s + step);
    // Platte unter der Fahrbahn und Gesims an den Seiten
    p.push(along(e, s, s1, 0, DECK_HALF * 2, -DECK_THICK, 0.08, stone, SURF.stone));
    for (const side of [-1, 1]) {
      p.push(along(e, s, s1, side * (DECK_HALF - 0.1), 0.45, -DECK_THICK - 0.15, -DECK_THICK + 0.12, dark, SURF.stone));
      // Brüstung: niedrige Mauer mit Abdeckung
      p.push(along(e, s, s1, side * (DECK_HALF - 0.2), 0.35, 0.08, 0.95, stone, SURF.stone));
      p.push(along(e, s, s1, side * (DECK_HALF - 0.2), 0.5, 0.95, 1.08, '#d6cebe', SURF.stone));
    }
  }
  // Pfeiler bis zum Grund, mit spitzem Eisbrecher quer zur Strömung
  const n = Math.max(1, Math.round(e.length / PIER_SPACING));
  for (let k = 1; k < n; k++) {
    const s = (k / n) * e.length;
    const c = e.pointAt(s);
    const d = e.directionAt(s);
    const ground = Math.min(terrain.sample(c.x, c.z), -2) - 1;
    const h = c.y - DECK_THICK - ground;
    const rot = Math.atan2(d.dx, d.dz);
    const pier = new THREE.BoxGeometry(DECK_HALF * 2 - 1, h, 2.4).rotateY(rot).translate(c.x, ground + h / 2, c.z);
    p.push(part(pier, stone, 0, SURF.stone, c.y));
    for (const side of [-1, 1]) {
      const nose = new THREE.CylinderGeometry(1.2, 1.4, Math.min(h, 4 - ground), 4, 1)
        .rotateY(Math.PI / 4).scale(0.8, 1, 1)
        .translate(side * (DECK_HALF - 0.5), ground + Math.min(h, 4 - ground) / 2, 0)
        .rotateY(rot)
        .translate(c.x, 0, c.z);
      p.push(part(nose, dark, 0, SURF.stone, c.y));
    }
    // Laterne auf jedem zweiten Pfeiler
    if (k % 2 === 1) {
      for (const side of [-1, 1]) {
        const lx = c.x - d.dz * side * (DECK_HALF - 0.2);
        const lz = c.z + d.dx * side * (DECK_HALF - 0.2);
        p.push(part(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).translate(lx, c.y + 2.6, lz), '#3b3f45'));
        p.push(part(new THREE.BoxGeometry(0.34, 0.42, 0.34).translate(lx, c.y + 4.3, lz), '#fff2c4', 0, SURF.light));
        p.push(part(new THREE.ConeGeometry(0.32, 0.3, 4).rotateY(Math.PI / 4).translate(lx, c.y + 4.66, lz), '#3b3f45'));
      }
    }
  }
  // Widerlager an beiden Ufern
  for (const s of [0, e.length]) {
    const c = e.pointAt(s);
    const d = e.directionAt(s);
    const ground = terrain.sample(c.x, c.z) - 3;
    const h = c.y - ground;
    p.push(part(new THREE.BoxGeometry(DECK_HALF * 2 + 1, h, 5).rotateY(Math.atan2(d.dx, d.dz)).translate(c.x, ground + h / 2, c.z), dark, 0, SURF.stone, c.y));
  }
  return p;
}

/**
 * Holzbrücke über einen Bergsee: Bohlenbelag auf Längsträgern, Geländer aus Pfosten
 * und Handlauf, Joche aus je zwei Rundholzpfählen mit Querbalken, kleine Laternen.
 */
function woodenBridgeParts(e: RoadEdge, terrain: Heightfield): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const wood = '#9a7652';
  const dark = '#5e4630';
  const level = waterUnder(e);
  const half = 3.6;
  for (let s = 0; s < e.length; s += 4) {
    const s1 = Math.min(e.length, s + 4);
    // Belag und Längsträger
    p.push(along(e, s, s1, 0, half * 2, -0.35, 0.06, wood, SURF.wood));
    for (const side of [-1, 1]) {
      p.push(along(e, s, s1, side * (half - 0.4), 0.35, -0.95, -0.35, dark, SURF.wood));
      // Handlauf und Mittelholm
      p.push(along(e, s, s1, side * (half - 0.12), 0.16, 1.0, 1.14, wood, SURF.wood));
      p.push(along(e, s, s1, side * (half - 0.12), 0.08, 0.5, 0.6, dark, SURF.wood));
    }
  }
  // Geländerpfosten alle 2 m
  for (let s = 0; s <= e.length; s += 2) {
    const c = e.pointAt(s);
    const d = e.directionAt(s);
    for (const side of [-1, 1]) {
      const x = c.x - d.dz * side * (half - 0.12);
      const z = c.z + d.dx * side * (half - 0.12);
      p.push(part(new THREE.BoxGeometry(0.14, 1.1, 0.14).rotateY(Math.atan2(d.dx, d.dz)).translate(x, c.y + 0.55, z), dark, 0, SURF.wood));
    }
  }
  // Joche: zwei Rundholzpfähle bis zum Seegrund, oben ein Querbalken
  const n = Math.max(1, Math.round(e.length / 14));
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * e.length;
    const c = e.pointAt(s);
    const d = e.directionAt(s);
    const rot = Math.atan2(d.dx, d.dz);
    for (const side of [-1, 1]) {
      const x = c.x - d.dz * side * (half - 0.6);
      const z = c.z + d.dx * side * (half - 0.6);
      const ground = Math.min(terrain.sample(x, z), level - 0.5) - 0.8;
      const h = c.y - 0.9 - ground;
      p.push(part(new THREE.CylinderGeometry(0.22, 0.26, h, 7).translate(x, ground + h / 2, z), dark, 0, SURF.wood));
    }
    p.push(part(new THREE.BoxGeometry(half * 2 + 0.4, 0.3, 0.35).rotateY(rot).translate(c.x, c.y - 1.05, c.z), dark, 0, SURF.wood));
    // Laterne an jedem dritten Joch, abwechselnd links und rechts
    if (k % 3 === 1) {
      const side = k % 2 ? 1 : -1;
      const lx = c.x - d.dz * side * (half - 0.12);
      const lz = c.z + d.dx * side * (half - 0.12);
      p.push(part(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 6).translate(lx, c.y + 1.9, lz), dark));
      p.push(part(new THREE.BoxGeometry(0.3, 0.36, 0.3).translate(lx, c.y + 2.85, lz), '#fff2c4', 0, SURF.light));
      p.push(part(new THREE.ConeGeometry(0.28, 0.26, 4).rotateY(Math.PI / 4).translate(lx, c.y + 3.16, lz), dark));
    }
  }
  return p;
}
