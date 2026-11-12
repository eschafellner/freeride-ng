import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';

/**
 * Häuser mit Varianten (Türen, Fenster, Läden, Blumenkästen) und Wege von der
 * Haustür zur Straße. Alles eigene Low-Poly-Entwürfe aus Grundkörpern.
 *
 * Jede Geometrie hat neben der Farbe ein Attribut `tint`: 1 = Wand (wird pro Haus
 * mit der Instanzfarbe getönt), 0 = Details mit fester Farbe.
 */

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;

/** Färbt eine Geometrie und markiert, ob sie pro Haus getönt wird. */
function part(geo: THREE.BufferGeometry, color: string | THREE.Color, tint = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  g.deleteAttribute('uv');
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Lambert mit Vertexfarben; die Instanzfarbe tönt nur Teile mit tint = 1. */
export function tintedMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, tint);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'tinted';
  return mat;
}

// --- Farben ------------------------------------------------------------------------------

const ROOFS = ['#b5523b', '#9c4a36', '#7a4b3a', '#5b5f66', '#a8613f', '#8c3f30'];
const DOORS = ['#6b4226', '#2f5d50', '#3b5b8a', '#8a2f2f', '#5a4632', '#4f6b3a', '#7a6a4f'];
const SHUTTERS = ['#3f6e4a', '#2f5d8a', '#8a5a2f', '#7a2f2f', '#5d6b73', '#4b7a72'];
const FRAMES = ['#f4efe4', '#efe6d2', '#6b4a32', '#e9e4da'];
const FLOWERS = ['#e63946', '#ff8fab', '#ffffff', '#ffd23f', '#9b5de5', '#f77f00'];
const GLASS = ['#3a4a5c', '#34495e', '#3d5266'];

interface WindowStyle {
  w: number;
  h: number;
  frame: string;
  glass: string;
  bars: boolean;
  shutters: string | null;
  boxes: boolean;
}

/**
 * Ein Fenster auf einer Wand. Lokale Lage: Mitte (x, y), Wand bei z = 0, außen = +z.
 * @param front Vorderseite: Läden und Blumenkästen nur dort
 */
function windowParts(s: WindowStyle, rng: Rng, front: boolean): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const { w, h } = s;
  p.push(part(box(w + 0.18, h + 0.18, 0.06, 0, 0, 0.03), s.frame));
  p.push(part(box(w, h, 0.06, 0, 0, 0.05), s.glass));
  if (s.bars) {
    p.push(part(box(0.06, h, 0.04, 0, 0, 0.09), s.frame));
    p.push(part(box(w, 0.06, 0.04, 0, h * 0.12, 0.09), s.frame));
  }
  // Fensterbank
  p.push(part(box(w + 0.3, 0.08, 0.22, 0, -h / 2 - 0.1, 0.1), '#d8d2c4'));
  if (front && s.shutters) {
    for (const side of [-1, 1]) {
      p.push(part(box(w * 0.5, h + 0.1, 0.05, side * (w * 0.75 + 0.12), 0, 0.04), s.shutters));
      // Querleisten auf den Läden
      for (const yy of [-h * 0.25, h * 0.25]) {
        p.push(part(box(w * 0.5, 0.05, 0.03, side * (w * 0.75 + 0.12), yy, 0.08), s.shutters));
      }
    }
  }
  if (front && s.boxes) {
    // Blumenkasten unter der Bank, darin Blätter und Blüten
    const bw = w + 0.1;
    p.push(part(box(bw, 0.24, 0.28, 0, -h / 2 - 0.28, 0.2), '#7a4e2d'));
    p.push(part(new THREE.IcosahedronGeometry(0.16, 0).scale(bw * 3, 1, 1.2).translate(0, -h / 2 - 0.08, 0.2), '#4f8a3a'));
    const n = 3 + Math.floor(rng() * 3);
    const c1 = pick(rng, FLOWERS);
    const c2 = pick(rng, FLOWERS);
    for (let k = 0; k < n; k++) {
      const x = -bw / 2 + 0.15 + (k / Math.max(1, n - 1)) * (bw - 0.3);
      p.push(part(new THREE.IcosahedronGeometry(0.1 + rng() * 0.04, 0).translate(x, -h / 2 + 0.02 + rng() * 0.06, 0.22 + rng() * 0.06), k % 2 ? c1 : c2));
    }
  }
  return p;
}

/** Dreht/verschiebt eine Teilliste auf eine Wand. */
function onWall(parts: THREE.BufferGeometry[], x: number, y: number, z: number, rotY: number): THREE.BufferGeometry[] {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  return parts.map((g) => g.applyMatrix4(m));
}

interface DoorStyle {
  kind: 'canopy' | 'arch' | 'double' | 'glass';
  color: string;
  frame: string;
}

/** Tür mit Stufe auf der Vorderseite. Lokale Lage: Mitte unten, Wand bei z = 0. */
function doorParts(s: DoorStyle, rng: Rng): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const w = s.kind === 'double' ? 1.7 : 1.05;
  const h = 2.1;
  p.push(part(box(w + 0.24, h + 0.14, 0.06, 0, h / 2 + 0.05, 0.03), s.frame));
  p.push(part(box(w, h, 0.08, 0, h / 2, 0.06), s.color));
  if (s.kind === 'double') p.push(part(box(0.05, h, 0.04, 0, h / 2, 0.11), s.frame));
  if (s.kind === 'glass') {
    p.push(part(box(w * 0.6, h * 0.35, 0.04, 0, h * 0.72, 0.11), '#4a5f73'));
  } else {
    // Füllungen
    for (const yy of [h * 0.3, h * 0.7]) {
      for (const xx of s.kind === 'double' ? [-w * 0.25, w * 0.25] : [0]) {
        p.push(part(box(w * (s.kind === 'double' ? 0.32 : 0.6), h * 0.28, 0.03, xx, yy, 0.11), new THREE.Color(s.color).multiplyScalar(0.8)));
      }
    }
  }
  if (s.kind === 'arch') {
    const arch = new THREE.CylinderGeometry(w / 2 + 0.12, w / 2 + 0.12, 0.1, 10, 1, false, -Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2).translate(0, h + 0.05, 0.05);
    p.push(part(arch, s.frame));
  }
  if (s.kind === 'canopy' || s.kind === 'double') {
    // Kleines Vordach auf Konsolen
    p.push(part(box(w + 0.9, 0.12, 1.0, 0, h + 0.45, 0.5).rotateX(0), '#7a4b3a'));
    for (const side of [-1, 1]) p.push(part(box(0.08, 0.4, 0.8, side * (w / 2 + 0.3), h + 0.22, 0.4), '#5a3a24'));
  }
  // Klinke, Stufe
  p.push(part(box(0.06, 0.06, 0.08, w * 0.35, h * 0.48, 0.14), '#c9b037'));
  p.push(part(box(w + 0.8, 0.3, 0.8, 0, 0.15, 0.4), '#b9b2a4'));
  // Wandleuchte oder Hausnummer
  if (rng() < 0.5) p.push(part(box(0.18, 0.26, 0.16, w / 2 + 0.45, h * 0.8, 0.1), '#2b2b2b'), part(box(0.12, 0.16, 0.12, w / 2 + 0.45, h * 0.78, 0.17), '#fff2c4'));
  else p.push(part(box(0.3, 0.22, 0.03, -(w / 2 + 0.4), h * 0.8, 0.03), '#2f5d8a'));
  // Blumentöpfe neben der Tür
  if (rng() < 0.65) {
    for (const side of rng() < 0.5 ? [1] : [-1, 1]) {
      const x = side * (w / 2 + 0.6);
      p.push(part(new THREE.CylinderGeometry(0.22, 0.16, 0.38, 7).translate(x, 0.19 + 0.3, 0.55), '#b5651d'));
      p.push(part(new THREE.IcosahedronGeometry(0.3, 0).translate(x, 0.75, 0.55), '#4f8a3a'));
      p.push(part(new THREE.IcosahedronGeometry(0.1, 0).translate(x + 0.08, 0.98, 0.62), pick(rng, FLOWERS)));
    }
  }
  return p;
}

export interface HouseVariant {
  geometry: THREE.BufferGeometry;
  /** Türmitte (x) und Vorderkante der Stufe (z) im Modell. */
  door: { x: number; z: number };
  kind: 'house' | 'townhouse';
}

/** Wohnhaus: zwei Geschosse, Walmdach, Sockel. */
function houseVariant(rng: Rng): HouseVariant {
  const w = 8, d = 7, h = 5, floorH = 2.5;
  const roof = pick(rng, ROOFS);
  const parts: THREE.BufferGeometry[] = [
    part(box(w, h, d, 0, h / 2, 0), '#ffffff', 1),
    part(box(w + 0.1, 0.5, d + 0.1, 0, 0.25, 0), '#a39a8c'), // Sockel
    part(new THREE.ConeGeometry(6.5, 3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.9).translate(0, h + 1.5, 0), roof),
    part(box(w + 0.5, 0.18, d + 0.5, 0, h + 0.05, 0), new THREE.Color(roof).multiplyScalar(0.75)), // Traufe
  ];
  if (rng() < 0.8) parts.push(part(box(0.7, 1.7, 0.7, (rng() < 0.5 ? 1 : -1) * 2.2, h + 1.9, -0.5), '#8d8d8d'));
  // Gaube auf der Vorderseite
  if (rng() < 0.4) {
    parts.push(part(box(1.6, 1.2, 1.6, 0, h + 1.0, d / 2 - 1.2), '#ffffff', 1));
    parts.push(part(new THREE.ConeGeometry(1.35, 0.8, 4).rotateY(Math.PI / 4).translate(0, h + 2.0, d / 2 - 1.2), roof));
    parts.push(...onWall(windowParts({ w: 0.7, h: 0.7, frame: '#f4efe4', glass: '#3a4a5c', bars: true, shutters: null, boxes: false }, rng, false), 0, h + 1.0, d / 2 - 0.4, 0));
  }

  const win: WindowStyle = {
    w: pick(rng, [0.9, 1.0, 0.8]),
    h: pick(rng, [1.1, 1.3, 1.0]),
    frame: pick(rng, FRAMES),
    glass: pick(rng, GLASS),
    bars: rng() < 0.6,
    shutters: rng() < 0.5 ? pick(rng, SHUTTERS) : null,
    boxes: rng() < 0.6,
  };
  const door: DoorStyle = { kind: pick(rng, ['canopy', 'arch', 'double', 'glass'] as const), color: pick(rng, DOORS), frame: pick(rng, FRAMES.slice(0, 2)) };
  const doorX = pick(rng, [0, 0, -w / 4, w / 4]);

  parts.push(...onWall(doorParts(door, rng), doorX, 0, d / 2, 0));
  for (let f = 0; f < 2; f++) {
    const y = f * floorH + floorH * 0.62;
    for (const x of [-w / 3, 0, w / 3]) {
      // Vorderseite: Erdgeschoss neben der Tür frei lassen
      if (!(f === 0 && Math.abs(x - doorX) < 1.6) && !(x === 0 && f === 0)) {
        parts.push(...onWall(windowParts(win, rng, true), x, y, d / 2, 0));
      }
      if (x !== 0) parts.push(...onWall(windowParts(win, rng, false), x, y, -d / 2, Math.PI));
    }
    for (const side of [1, -1]) parts.push(...onWall(windowParts(win, rng, false), side * w / 2, y, 0, side * Math.PI / 2));
  }
  return { geometry: mergeGeometries(parts)!, door: { x: doorX, z: d / 2 + 0.8 }, kind: 'house' };
}

/** Stadthaus: schmal, drei Geschosse, Gesims; manchmal mit Laden im Erdgeschoss. */
function townhouseVariant(rng: Rng): HouseVariant {
  const w = 6, d = 9, h = 8.5, floorH = 2.8;
  const roof = pick(rng, ROOFS);
  const parts: THREE.BufferGeometry[] = [
    part(box(w, h, d, 0, h / 2, 0), '#ffffff', 1),
    part(box(w + 0.1, 0.6, d + 0.1, 0, 0.3, 0), '#9d968a'),
    part(box(w + 0.4, 0.3, d + 0.4, 0, h, 0), '#d8d2c4'),
    part(box(w + 0.16, 0.14, d + 0.16, 0, floorH * 1.02, 0), '#e4ded0'), // Gesims
    part(new THREE.ConeGeometry(5.6, 1.8, 4).rotateY(Math.PI / 4).scale(0.75, 1, 1.1).translate(0, h + 1.05, 0), roof),
  ];
  const win: WindowStyle = {
    w: pick(rng, [0.85, 0.95]),
    h: pick(rng, [1.3, 1.5]),
    frame: pick(rng, FRAMES),
    glass: pick(rng, GLASS),
    bars: rng() < 0.7,
    shutters: rng() < 0.4 ? pick(rng, SHUTTERS) : null,
    boxes: rng() < 0.7,
  };
  const shop = rng() < 0.4;
  const door: DoorStyle = { kind: pick(rng, ['arch', 'glass', 'canopy'] as const), color: pick(rng, DOORS), frame: '#efe6d2' };
  let doorX = 0;
  if (shop) {
    // Laden: großes Schaufenster, gestreifte Markise, Tür seitlich
    doorX = w / 2 - 1.1;
    const awning = pick(rng, [['#c0392b', '#f4efe4'], ['#2f5d8a', '#f4efe4'], ['#3f6e4a', '#efe6d2']] as const);
    parts.push(part(box(3.4, 1.7, 0.08, -0.9, 1.45, d / 2 + 0.04), '#4a5f73'));
    parts.push(part(box(3.6, 0.12, 0.12, -0.9, 2.35, d / 2 + 0.08), '#efe6d2'));
    for (let k = 0; k < 6; k++) {
      parts.push(part(box(0.62, 0.08, 1.3, -0.9 - 1.55 + k * 0.62, 2.75, d / 2 + 0.6).rotateX(0), awning[k % 2]!));
    }
    parts.push(part(box(3.4, 0.4, 0.06, -0.9, 3.05, d / 2 + 0.03), '#2b2b2b'));
  }
  parts.push(...onWall(doorParts(door, rng), doorX, 0, d / 2, 0));
  for (let f = 0; f < 3; f++) {
    const y = f * floorH + floorH * 0.6;
    for (const x of [-w / 4, w / 4]) {
      if (f > 0 || (!shop && Math.abs(x - doorX) > 1.4)) parts.push(...onWall(windowParts(win, rng, true), x, y, d / 2, 0));
      parts.push(...onWall(windowParts(win, rng, false), x, y, -d / 2, Math.PI));
    }
    for (const side of [1, -1]) {
      for (const z of [-d / 4, d / 4]) parts.push(...onWall(windowParts(win, rng, false), side * w / 2, y, z, side * Math.PI / 2));
    }
  }
  return { geometry: mergeGeometries(parts)!, door: { x: doorX, z: d / 2 + 0.8 }, kind: 'townhouse' };
}

export function createHouseVariants(rng: Rng, houses = 8, townhouses = 6): { houses: HouseVariant[]; townhouses: HouseVariant[] } {
  return {
    houses: Array.from({ length: houses }, () => houseVariant(rng)),
    townhouses: Array.from({ length: townhouses }, () => townhouseVariant(rng)),
  };
}

// --- Wege von der Tür zur Straße ------------------------------------------------------------

export interface FrontPath {
  /** Vor der Türstufe. */
  from: { x: number; z: number };
  /** Am Rand von Gehsteig oder Fahrbahn. */
  to: { x: number; z: number };
}

/** Punkt auf dem leicht geschwungenen Weg (quadratische Kurve mit seitlicher Ausbuchtung). */
export function pathPoint(p: FrontPath, bend: number, t: number): { x: number; z: number } {
  const dx = p.to.x - p.from.x;
  const dz = p.to.z - p.from.z;
  const len = Math.hypot(dx, dz) || 1;
  const cx = (p.from.x + p.to.x) / 2 - (dz / len) * bend;
  const cz = (p.from.z + p.to.z) / 2 + (dx / len) * bend;
  const u = 1 - t;
  return {
    x: u * u * p.from.x + 2 * u * t * cx + t * t * p.to.x,
    z: u * u * p.from.z + 2 * u * t * cz + t * t * p.to.z,
  };
}

const STONE = new THREE.CylinderGeometry(1, 1, 1, 7);
const PEBBLE = new THREE.DodecahedronGeometry(1, 0);
function flowerGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4).translate(0, 0.15, 0), '#4f8a3a'),
    part(new THREE.IcosahedronGeometry(0.09, 0).scale(1.2, 0.6, 1.2).translate(0, 0.32, 0), '#ffffff', 1),
    part(new THREE.IcosahedronGeometry(0.12, 0).scale(1, 0.5, 1.6).translate(0.08, 0.06, 0), '#5c9a3a'),
  ])!;
}

/**
 * Trittsteine von der Tür zur Straße, mit Kieseln und Blumen am Rand.
 * @returns Gruppe und die Mittellinien der Wege (damit dort kein Gras wächst)
 */
export function createFrontPaths(paths: FrontPath[], terrain: Heightfield, rng: Rng): { group: THREE.Group; lines: { x: number; z: number }[][] } {
  const stones: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const pebbles: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const flowers: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const lines: { x: number; z: number }[][] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = (x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rot), new THREE.Vector3(sx, sy, sz));
  const stoneColors = ['#b9b2a4', '#a8a091', '#c4bcae', '#9d968a', '#b3a68e'];

  for (const p of paths) {
    const len = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z);
    if (len < 1.2) continue;
    const bend = (rng() - 0.5) * Math.min(2.4, len * 0.35);
    const line: { x: number; z: number }[] = [];
    const step = 0.72;
    const n = Math.max(2, Math.round(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const c = pathPoint(p, bend, t);
      line.push(c);
      // Richtung für die Seiten
      const c2 = pathPoint(p, bend, Math.min(1, t + 0.02));
      const c1 = pathPoint(p, bend, Math.max(0, t - 0.02));
      const dl = Math.hypot(c2.x - c1.x, c2.z - c1.z) || 1;
      const nx = -(c2.z - c1.z) / dl;
      const nz = (c2.x - c1.x) / dl;
      // Trittstein mit kleinem Versatz
      const jx = (rng() - 0.5) * 0.18;
      const jz = (rng() - 0.5) * 0.18;
      const r = 0.26 + rng() * 0.12;
      const x = c.x + jx;
      const z = c.z + jz;
      stones.push({
        m: at(x, terrain.meshHeight(x, z) + 0.03, z, rng() * 6, r * (1 + rng() * 0.3), 0.08, r),
        c: new THREE.Color(pick(rng, stoneColors)),
      });
      // Kiesel und Blumen am Rand
      for (const side of [-1, 1]) {
        const off = 0.62 + rng() * 0.2;
        const px = c.x + nx * off * side;
        const pz = c.z + nz * off * side;
        const roll = rng();
        if (roll < 0.55) {
          const s = 0.07 + rng() * 0.09;
          pebbles.push({ m: at(px, terrain.meshHeight(px, pz) + s * 0.4, pz, rng() * 6, s * 1.3, s, s), c: new THREE.Color(pick(rng, stoneColors)) });
        } else if (roll < 0.8 && k > 0 && k < n) {
          for (let f = 0; f < 3; f++) {
            const fx = px + (rng() - 0.5) * 0.4;
            const fz = pz + (rng() - 0.5) * 0.4;
            flowers.push({ m: at(fx, terrain.meshHeight(fx, fz), fz, rng() * 6, 0.8 + rng() * 0.5, 0.8 + rng() * 0.6, 0.8 + rng() * 0.5), c: new THREE.Color(pick(rng, FLOWERS)) });
          }
        }
      }
    }
    lines.push(line);
  }

  const group = new THREE.Group();
  const mesh = (geo: THREE.BufferGeometry, items: { m: THREE.Matrix4; c: THREE.Color }[], mat: THREE.Material, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((it, i) => {
      im.setMatrixAt(i, it.m);
      im.setColorAt(i, it.c);
    });
    im.count = items.length;
    im.castShadow = shadow;
    im.receiveShadow = true;
    group.add(im);
  };
  mesh(STONE, stones, new THREE.MeshLambertMaterial({ flatShading: true }), false);
  mesh(PEBBLE, pebbles, new THREE.MeshLambertMaterial({ flatShading: true }), false);
  mesh(flowerGeometry(), flowers, tintedMaterial(), false);
  return { group, lines };
}
