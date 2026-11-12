import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';
import { hasTerrace, type ShopType } from '../world/shops';
import type { ShopWindow } from './houses';

/**
 * Ladenfronten: Markise, Schild mit Namen, Auslage im Schaufenster und je nach
 * Art ein Außenbereich (Tische, Schirme, Fahrradständer, Blumeneimer, Fässer …).
 * Alles eigene Low-Poly-Entwürfe, zu wenigen Meshes zusammengeführt.
 */

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;

/** Markisen- und Schildfarben je Art: [Hauptfarbe, Streifen/Schrift]. */
export const SHOP_COLORS: Record<ShopType, [string, string]> = {
  fahrrad: ['#1c7ed6', '#f4efe4'],
  cafe: ['#8a5a2f', '#f4efe4'],
  restaurant: ['#2f6b3a', '#f4efe4'],
  baecker: ['#c98a12', '#5a3a1e'],
  mode: ['#2b2b2b', '#e9e4da'],
  buch: ['#7a2f2f', '#efe6d2'],
  blumen: ['#d6336c', '#ffffff'],
  eis: ['#f783ac', '#e6fcf5'],
  fisch: ['#1d4e89', '#ffffff'],
  weinstube: ['#6d2e46', '#efe6d2'],
  dorfladen: ['#3f6e4a', '#efe6d2'],
  gasthaus: ['#5a3a24', '#efe6d2'],
  hofladen: ['#8a5a2f', '#f4efe4'],
};

const FLOWERS = ['#e63946', '#ff8fab', '#ffffff', '#ffd23f', '#9b5de5', '#f77f00'];

/** Ein Laden, wie er in der Welt steht. */
export interface ShopPlacement {
  type: ShopType;
  name: string;
  /** Lage und Drehung des Gebäudes; Front zeigt in lokale +z-Richtung. */
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Maßstab des Gebäudes in der Fläche und in der Höhe. */
  sc: number;
  sy: number;
  /** Vorderwand (z) und Schaufenster im Modell; ohne Fenster: Scheune (Hofladen). */
  front: number;
  window?: ShopWindow;
  door: { x: number; z: number };
  /** Platz vor der Front bis zum Gehsteig/Fahrbahnrand in m. */
  depth: number;
}

// --- Bausteine ----------------------------------------------------------------------------

function colored(geo: THREE.BufferGeometry, color: string | THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string | THREE.Color) =>
  colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, c: string | THREE.Color, seg = 8) =>
  colored(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z), c);
const ball = (r: number, x: number, y: number, z: number, c: string | THREE.Color, sx = 1, sy = 1, sz = 1) =>
  colored(new THREE.IcosahedronGeometry(r, 0).scale(sx, sy, sz).translate(x, y, z), c);

/** Runder Bistrotisch mit zwei Stühlen, Ursprung am Boden. */
function bistroSet(rng: Rng, chair: string): THREE.BufferGeometry[] {
  const p = [
    cyl(0.04, 0.04, 0.72, 0, 0, 0, '#3b3f45', 6),
    cyl(0.18, 0.22, 0.04, 0, 0, 0, '#3b3f45', 8),
    cyl(0.38, 0.38, 0.04, 0, 0.72, 0, '#f4efe4', 10),
  ];
  for (const side of [-1, 1]) {
    const x = side * 0.62;
    p.push(box(0.42, 0.05, 0.42, x, 0.45, 0, chair));
    p.push(box(0.05, 0.5, 0.42, x + side * 0.2, 0.7, 0, chair));
    for (const lx of [-0.17, 0.17]) for (const lz of [-0.17, 0.17]) p.push(box(0.04, 0.45, 0.04, x + lx, 0.22, lz, '#3b3f45'));
  }
  if (rng() < 0.5) p.push(ball(0.07, 0.1, 0.8, 0.05, pick(rng, FLOWERS)));
  return p;
}

/** Sonnenschirm, Ursprung am Boden. */
function umbrella(color: string, stripe: string): THREE.BufferGeometry[] {
  const p = [cyl(0.03, 0.03, 2.3, 0, 0, 0, '#e9e4da', 5), cyl(0.25, 0.3, 0.12, 0, 0, 0, '#5d6b73', 8)];
  const cone = new THREE.ConeGeometry(1.35, 0.45, 8).translate(0, 2.3, 0).toNonIndexed();
  // Abwechselnd gefärbte Segmente
  const n = cone.attributes.position!.count;
  const col = new Float32Array(n * 3);
  const a = new THREE.Color(color);
  const b = new THREE.Color(stripe);
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / 3) % 2 ? a : b;
    col.set([c.r, c.g, c.b], i * 3);
  }
  cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
  cone.deleteAttribute('uv');
  p.push(cone);
  return p;
}

/** Lange Biertischgarnitur, Ursprung am Boden, entlang x. */
function benchSet(len = 2.0): THREE.BufferGeometry[] {
  const wood = '#9a6b45';
  const p = [box(len, 0.05, 0.6, 0, 0.74, 0, wood)];
  for (const z of [-0.6, 0.6]) p.push(box(len, 0.05, 0.25, 0, 0.44, z, wood));
  for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) {
    p.push(box(0.05, 0.74, 0.5, x, 0.37, 0, '#5a3a24'));
    for (const z of [-0.6, 0.6]) p.push(box(0.05, 0.44, 0.2, x, 0.22, z, '#5a3a24'));
  }
  return p;
}

/** Einfaches Fahrrad für Ständer und Schaufenster, Ursprung am Boden, Länge entlang x. */
function bike(frame: string): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  for (const x of [-0.5, 0.5]) p.push(colored(new THREE.TorusGeometry(0.32, 0.03, 4, 12).translate(x, 0.33, 0), '#222'));
  const tube = (a: THREE.Vector3, b: THREE.Vector3, c = frame) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.022, 0.022, len, 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    p.push(colored(g, c));
  };
  const bb = new THREE.Vector3(0, 0.3, 0);
  const seat = new THREE.Vector3(-0.12, 0.82, 0);
  const head = new THREE.Vector3(0.38, 0.85, 0);
  tube(bb, seat);
  tube(seat, head);
  tube(bb, head);
  tube(bb, new THREE.Vector3(-0.5, 0.33, 0));
  tube(seat, new THREE.Vector3(-0.5, 0.33, 0));
  tube(head, new THREE.Vector3(0.5, 0.33, 0));
  p.push(box(0.05, 0.03, 0.45, 0.42, 0.95, 0, '#222'), box(0.22, 0.05, 0.1, -0.13, 0.86, 0, '#222'));
  return p;
}

/** Klapptafel (Speisekarte, Angebot), Ursprung am Boden. */
function aFrame(board: string): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.55, 0.85, 0.04).translate(0, 0.42, 0).rotateX(side * 0.2).translate(0, 0, side * 0.09);
    p.push(colored(g, '#6b4a32'));
    const face = new THREE.BoxGeometry(0.45, 0.6, 0.02).translate(0, 0.45, 0.025 * side).rotateX(side * 0.2).translate(0, 0, side * 0.09);
    p.push(colored(face, board));
  }
  return p;
}

function planter(rng: Rng): THREE.BufferGeometry[] {
  return [
    box(0.5, 0.45, 0.5, 0, 0.22, 0, '#8a7f72'),
    ball(0.38, 0, 0.7, 0, '#4f8a3a', 1, 0.9, 1),
    ball(0.09, 0.15, 0.95, 0.1, pick(rng, FLOWERS)),
    ball(0.09, -0.12, 0.92, -0.05, pick(rng, FLOWERS)),
  ];
}

function crate(fill: string, rng: Rng): THREE.BufferGeometry[] {
  const p = [box(0.6, 0.3, 0.4, 0, 0.15, 0, '#b08a5a')];
  for (let k = 0; k < 5; k++) p.push(ball(0.08 + rng() * 0.03, -0.2 + k * 0.1, 0.32, (rng() - 0.5) * 0.2, fill));
  return p;
}

function barrel(): THREE.BufferGeometry[] {
  return [
    colored(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 10).scale(1, 1, 1).translate(0, 0.45, 0), '#7a4e2d'),
    cyl(0.335, 0.335, 0.06, 0, 0.15, 0, '#3b3f45', 10),
    cyl(0.335, 0.335, 0.06, 0, 0.7, 0, '#3b3f45', 10),
  ];
}

// --- Auslage im Schaufenster (vor der hellen Rückwand) ------------------------------------------

function display(type: ShopType, w: ShopWindow, z: number, rng: Rng): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const left = w.x - w.width / 2 + 0.3;
  const right = w.x + w.width / 2 - 0.3;
  const shelf = (y: number) => p.push(box(w.width - 0.2, 0.04, 0.12, w.x, y, z, '#b8a888'));
  const across = (n: number, f: (x: number, k: number) => void) => {
    for (let k = 0; k < n; k++) f(left + ((right - left) * (k + 0.5)) / n, k);
  };
  switch (type) {
    case 'baecker':
      shelf(w.bottom + 0.35);
      shelf(w.bottom + 0.85);
      for (const y of [w.bottom + 0.42, w.bottom + 0.92]) across(6, (x) => p.push(ball(0.13, x, y, z + 0.02, pick(rng, ['#b5763a', '#c98a4a', '#8a5a2f']), 1.4, 0.7, 0.9)));
      break;
    case 'mode':
      across(3, (x, k) => {
        const c = pick(rng, ['#2f5d8a', '#c0392b', '#f4efe4', '#3f6e4a', '#e6c07b']);
        p.push(cyl(0.02, 0.02, 0.4, x, w.bottom, z, '#3b3f45', 4), box(0.42, 0.6, 0.18, x, w.bottom + 0.7, z, c));
        p.push(ball(0.1, x, w.bottom + 1.12, z, '#e9e4da'));
        if (k === 1) p.push(box(0.4, 0.35, 0.16, x, w.bottom + 0.2, z, '#2b2b2b'));
      });
      break;
    case 'buch':
      shelf(w.bottom + 0.3);
      shelf(w.bottom + 0.8);
      for (const y of [w.bottom + 0.45, w.bottom + 0.95]) across(14, (x) => p.push(box(0.12, 0.24 + rng() * 0.06, 0.1, x, y, z, pick(rng, ['#7a2f2f', '#2f5d8a', '#3f6e4a', '#d4a017', '#5d6b73', '#efe6d2']))));
      break;
    case 'fahrrad':
      across(2, (x) => p.push(...bike(pick(rng, ['#1c7ed6', '#e63946', '#2b2b2b'])).map((g) => g.scale(0.8, 0.8, 0.8).translate(x, w.bottom, z))));
      break;
    case 'blumen':
    case 'dorfladen':
      across(4, (x) => p.push(...crate(pick(rng, type === 'blumen' ? FLOWERS : ['#e63946', '#f77f00', '#6aa13f']), rng).map((g) => g.translate(x, w.bottom + 0.1, z))));
      break;
    case 'eis':
      shelf(w.bottom + 0.5);
      across(6, (x) => p.push(ball(0.11, x, w.bottom + 0.62, z, pick(rng, ['#ffe066', '#ff8fab', '#a0e7e5', '#f4efe4', '#8a5a2f']))));
      break;
    case 'fisch':
      p.push(box(w.width - 0.4, 0.15, 0.14, w.x, w.bottom + 0.3, z, '#dfe7ea'));
      across(5, (x) => p.push(ball(0.1, x, w.bottom + 0.42, z, '#9fb3c8', 2.2, 0.6, 0.8)));
      break;
    default:
      // Gastronomie: Kuchen, Gläser, Pflanzen
      shelf(w.bottom + 0.5);
      across(5, (x, k) => p.push(k % 2
        ? cyl(0.12, 0.12, 0.15, x, w.bottom + 0.52, z, pick(rng, ['#f4efe4', '#e6c07b', '#8a5a2f']), 8)
        : cyl(0.04, 0.05, 0.2, x, w.bottom + 0.52, z, '#cfe3ea', 6)));
      break;
  }
  return p;
}

// --- Schilder (Texturatlas) -------------------------------------------------------------------

const SIGN_W = 512;
const SIGN_H = 96;
const ATLAS_COLS = 4;

/** Zeichnet alle Schilder in einen Texturatlas; liefert UV-Rechteck je Laden. */
function signAtlas(shops: ShopPlacement[]): { texture: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const rows = Math.max(1, Math.ceil(shops.length / ATLAS_COLS));
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_W * ATLAS_COLS;
  canvas.height = SIGN_H * rows;
  const ctx = canvas.getContext('2d')!;
  shops.forEach((s, i) => {
    const x = (i % ATLAS_COLS) * SIGN_W;
    const y = Math.floor(i / ATLAS_COLS) * SIGN_H;
    const [bg, fg] = SHOP_COLORS[s.type];
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, SIGN_W, SIGN_H);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 8, y + 8, SIGN_W - 16, SIGN_H - 16);
    ctx.fillStyle = fg;
    ctx.font = `bold 50px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.name, x + SIGN_W / 2, y + SIGN_H / 2 + 2, SIGN_W - 40);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return {
    texture,
    uv: (i) => {
      const u0 = (i % ATLAS_COLS) / ATLAS_COLS;
      const v1 = 1 - Math.floor(i / ATLAS_COLS) / rows;
      return [u0, v1 - 1 / rows, u0 + 1 / ATLAS_COLS, v1];
    },
  };
}

function signPlane(width: number, height: number, uv: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height);
  const a = g.attributes.uv!;
  for (let k = 0; k < a.count; k++) {
    a.setXY(k, a.getX(k) === 0 ? uv[0] : uv[2], a.getY(k) === 0 ? uv[1] : uv[3]);
  }
  return g;
}

// --- Zusammenbau --------------------------------------------------------------------------------

/**
 * Baut alle Ladenfronten. Teile an der Wand folgen dem Gebäude (Maßstab sc/sy),
 * Möbel davor stehen auf dem Gelände.
 */
export function createShopFronts(shops: ShopPlacement[], terrain: Heightfield, rng: Rng): THREE.Group {
  const group = new THREE.Group();
  if (shops.length === 0) return group;
  const parts: THREE.BufferGeometry[] = [];
  const signs: THREE.BufferGeometry[] = [];
  const atlas = signAtlas(shops);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();

  shops.forEach((s, i) => {
    q.setFromAxisAngle(up, s.rot);
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
    /** Wandteil: Modellkoordinaten (vor Maßstab) → Welt. */
    const onWall = (g: THREE.BufferGeometry) => parts.push(g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sc, s.sy, s.sc))));
    /** Möbel: lokale Lage vor der Front (Meter, ohne Maßstab), auf dem Gelände. */
    const ground = (gs: THREE.BufferGeometry[], lx: number, lz: number, rot = 0) => {
      v.set(lx, 0, lz).applyMatrix4(frame);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(v.x, terrain.meshHeight(v.x, v.z), v.z),
        new THREE.Quaternion().setFromAxisAngle(up, s.rot + rot),
        new THREE.Vector3(1, 1, 1),
      );
      for (const g of gs) parts.push(g.applyMatrix4(m));
    };
    const [main, second] = SHOP_COLORS[s.type];
    const front = s.front;
    const frontWorld = front * s.sc;

    if (s.window) {
      const w = s.window;
      // Auslage, Markise (gestreift, schräg), Schild darüber
      for (const g of display(s.type, w, front + 0.18, rng)) onWall(g);
      const aw = w.width + 0.6;
      const stripes = Math.max(4, Math.round(aw / 0.45));
      for (let k = 0; k < stripes; k++) {
        const x = w.x - aw / 2 + (aw * (k + 0.5)) / stripes;
        const g = new THREE.BoxGeometry(aw / stripes, 0.05, 1.1).rotateX(0.38).translate(x, w.top + 0.32, front + 0.55);
        onWall(colored(g, k % 2 ? second : main));
      }
      onWall(box(aw, 0.22, 0.04, w.x, w.top + 0.06, front + 1.06, main));
      const sign = signPlane(w.width + 0.2, (w.width + 0.2) * (SIGN_H / SIGN_W), atlas.uv(i));
      sign.translate(w.x, w.top + 0.95, front + 0.07);
      signs.push(sign.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.sc, s.sy, s.sc))));
      // Ausleger-Schild quer zur Straße bei Gasthäusern
      if (s.type === 'gasthaus' || s.type === 'weinstube' || s.type === 'fahrrad') {
        const ax = s.door.x + (s.door.x > w.x ? 0.9 : -0.9);
        onWall(box(0.06, 0.06, 0.9, ax, w.top + 0.9, front + 0.45, '#2b2b2b'));
        onWall(box(0.05, 0.55, 0.55, ax, w.top + 0.55, front + 0.7, main));
        onWall(box(0.06, 0.35, 0.35, ax, w.top + 0.55, front + 0.7, second));
      }
    } else {
      // Hofladen an der Scheune: Schild auf zwei Pfosten nahe der Straße
      const lz = frontWorld + Math.max(1.5, s.depth - 1.2);
      ground([box(0.1, 1.6, 0.1, -0.9, 0.8, 0, '#6b4a32'), box(0.1, 1.6, 0.1, 0.9, 0.8, 0, '#6b4a32')], 3, lz);
      v.set(3, 0, lz).applyMatrix4(frame);
      const sign = signPlane(2.0, 2.0 * (SIGN_H / SIGN_W), atlas.uv(i));
      sign.translate(0, 0, 0.06).applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(v.x, terrain.meshHeight(v.x, v.z) + 1.35, v.z), q, new THREE.Vector3(1, 1, 1)));
      signs.push(sign);
      ground([box(2.1, 0.45, 0.06, 0, 1.35, 0, '#6b4a32')], 3, lz - 0.02);
    }

    // Außenbereich zwischen Front und Gehsteig, Tür und Weg bleiben frei
    const depth = s.depth;
    const doorX = s.door.x * s.sc;
    const halfW = (s.window ? 3.6 : 5.5) * s.sc;
    const slots: number[] = [];
    for (let x = -halfW + 0.9; x <= halfW - 0.9; x += 1.9) if (Math.abs(x - doorX) > 1.4) slots.push(x);
    const rowZ = frontWorld + Math.min(depth - 0.6, 1.6);
    if (depth < 1.2) return;
    switch (s.type) {
      case 'cafe':
      case 'eis':
        slots.forEach((x, k) => {
          ground(bistroSet(rng, s.type === 'eis' ? pick(rng, ['#a0e7e5', '#f783ac', '#ffe066']) : '#6b4a32'), x, rowZ);
          if (k % 2 === 0 && depth > 2) ground(umbrella(main, second), x, rowZ);
        });
        if (s.type === 'eis') ground([cyl(0.04, 0.04, 1.6, 0, 0, 0, '#5d6b73', 5), colored(new THREE.ConeGeometry(0.22, 0.5, 8).rotateX(Math.PI).translate(0, 1.85, 0), '#d4a35a'), ball(0.24, 0, 2.15, 0, '#f783ac')], doorX + 1.2, frontWorld + 0.5);
        break;
      case 'restaurant':
      case 'gasthaus':
      case 'weinstube':
        slots.slice(0, 3).forEach((x, k) => {
          if (s.type === 'restaurant') ground(bistroSet(rng, '#f4efe4'), x, rowZ);
          else ground(benchSet(1.7), x, rowZ);
          if (k % 2 === 0 && depth > 2) ground(umbrella(main, second), x, rowZ);
        });
        ground(aFrame('#2b2b2b'), doorX + 1.0, frontWorld + Math.min(depth - 0.4, 0.9), 0.3);
        if (s.type === 'weinstube') ground([...barrel(), ...barrel().map((g) => g.translate(0.7, 0, 0.1))], doorX - 1.3, frontWorld + 0.5);
        ground(planter(rng), doorX - 0.9, frontWorld + 0.4);
        break;
      case 'fahrrad': {
        // Fahrradständer mit drei Rädern, quer zur Front
        const x0 = slots[0] ?? -halfW + 1;
        ground([box(0.05, 0.5, 2.2, 0, 0.25, 0, '#5d6b73'), box(0.05, 0.05, 2.2, 0, 0.5, 0, '#5d6b73')], x0 + 0.4, rowZ, Math.PI / 2);
        for (let k = 0; k < 3; k++) ground(bike(pick(rng, ['#1c7ed6', '#e63946', '#2b2b2b', '#f4efe4', '#3f6e4a'])), x0 - 0.6 + k * 0.75, rowZ, Math.PI / 2);
        ground(aFrame('#1c7ed6'), doorX + 1.0, frontWorld + 0.6, 0.3);
        break;
      }
      case 'blumen':
        slots.forEach((x) => {
          for (let k = 0; k < 3; k++) {
            ground([cyl(0.18, 0.15, 0.4, 0, 0, 0, '#5d6b73', 8), ball(0.22, 0, 0.55, 0, '#4f8a3a'), ball(0.1, 0.06, 0.72, 0.05, pick(rng, FLOWERS)), ball(0.1, -0.08, 0.68, -0.04, pick(rng, FLOWERS))], x - 0.5 + k * 0.5, rowZ - 0.3 + (k % 2) * 0.4);
          }
        });
        break;
      case 'baecker':
      case 'buch':
      case 'mode':
        ground(aFrame(type2board(s.type)), doorX + (doorX > 0 ? -1.2 : 1.2), frontWorld + 0.6, 0.3);
        if (s.type === 'buch' && slots[0] !== undefined) ground([box(1.2, 0.7, 0.5, 0, 0.35, 0, '#6b4a32'), ...Array.from({ length: 8 }, (_, k) => box(0.12, 0.22, 0.35, -0.45 + k * 0.13, 0.81, 0, pick(rng, ['#7a2f2f', '#2f5d8a', '#3f6e4a', '#d4a017'])))], slots[0], rowZ);
        if (s.type === 'mode' && slots[0] !== undefined) {
          ground([box(0.04, 1.5, 0.04, -0.6, 0.75, 0, '#3b3f45'), box(0.04, 1.5, 0.04, 0.6, 0.75, 0, '#3b3f45'), box(1.24, 0.04, 0.04, 0, 1.5, 0, '#3b3f45'),
            ...Array.from({ length: 5 }, (_, k) => box(0.08, 0.7, 0.4, -0.45 + k * 0.22, 1.1, 0, pick(rng, ['#2f5d8a', '#c0392b', '#f4efe4', '#3f6e4a', '#e6c07b'])))], slots[0], rowZ);
        }
        ground(planter(rng), doorX + (doorX > 0 ? 1.0 : -1.0), frontWorld + 0.4);
        break;
      case 'fisch':
        slots.slice(0, 2).forEach((x) => ground(benchSet(1.5), x, rowZ));
        ground([...crate('#9fb3c8', rng), ...crate('#9fb3c8', rng).map((g) => g.translate(0, 0.3, 0))], doorX - 1.1, frontWorld + 0.4);
        onWall(colored(new THREE.TorusGeometry(0.3, 0.07, 6, 12).translate((s.window?.x ?? 0) + 2.4, 1.9, front + 0.08), '#e63946'));
        break;
      case 'dorfladen':
      case 'hofladen':
        slots.slice(0, 3).forEach((x) => {
          ground([box(1.4, 0.06, 0.6, 0, 0.7, 0, '#9a6b45'), box(0.06, 0.7, 0.6, -0.65, 0.35, 0, '#6b4a32'), box(0.06, 0.7, 0.6, 0.65, 0.35, 0, '#6b4a32')], x, rowZ);
          ground(crate(pick(rng, ['#e63946', '#f77f00', '#6aa13f', '#ffd23f']), rng).map((g) => g.translate(-0.35, 0.73, 0)), x, rowZ);
          ground(crate(pick(rng, ['#e63946', '#f77f00', '#6aa13f', '#ffd23f']), rng).map((g) => g.translate(0.35, 0.73, 0)), x, rowZ);
        });
        if (s.type === 'hofladen') for (let k = 0; k < 4; k++) ground([ball(0.3, 0, 0.25, 0, '#e8740c', 1.2, 0.8, 1.2), cyl(0.03, 0.03, 0.15, 0, 0.45, 0, '#4f6b3a', 4)], -1.5 + k * 0.7, rowZ + 0.9);
        break;
    }
    if (hasTerrace(s.type) && depth > 1.6) ground(planter(rng), -halfW + 0.3, frontWorld + 0.35);
  });

  const geo = mergeGeometries(parts);
  if (geo) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const signGeo = mergeGeometries(signs);
  if (signGeo) {
    const mesh = new THREE.Mesh(signGeo, new THREE.MeshLambertMaterial({ map: atlas.texture }));
    group.add(mesh);
  }
  return group;
}

function type2board(type: ShopType): string {
  return SHOP_COLORS[type][0];
}
