import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightfield } from '../world/heightfield';
import { lod, LodInstances } from './lod';
import { NOISE_GLSL } from './shaderChunks';

/**
 * Häuser mit Varianten (Dachformen, Fachwerk, Eckquader, Balkone, Türen, Fenster,
 * Läden, Efeu) und Wege von der Haustür zur Straße. Alles eigene Low-Poly-Entwürfe
 * aus Grundkörpern.
 *
 * Jede Geometrie hat neben der Farbe zwei Attribute:
 * - `tint`: 1 = Wand (wird pro Haus mit der Instanzfarbe getönt), 0 = feste Farbe
 * - `surf`: (Oberflächenart, Wandoberkante, Geschosshöhe). Die Oberfläche (Putz,
 *   Ziegel, Fachwerk …) entsteht im Shader aus den Modellkoordinaten, ohne Bilddateien.
 */

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;

/** Oberflächenarten für den Shader (Attribut `surf.x`). */
export const SURF = { detail: 0, plaster: 1, roof: 2, stone: 3, timber: 4, wood: 5, glass: 6, paving: 7, light: 8 } as const;

/** Nachtleuchten von Lampen und Fenstern (0 = Tag, 1 = Nacht), gesetzt vom Tag-Nacht-Wechsel. */
export const NIGHT_GLOW = { value: 0 };
/** Anteil der Fenster, die nachts erleuchtet sind. */
const LIT_WINDOWS = 0.3;
export type Surf = (typeof SURF)[keyof typeof SURF];

/**
 * Färbt eine Geometrie und setzt Tönung und Oberfläche.
 * @param top Wandoberkante (für Traufschatten und Regenspuren)
 * @param floorH Geschosshöhe (für Fachwerk)
 */
export function part(
  geo: THREE.BufferGeometry,
  color: string | THREE.Color,
  tint = 0,
  surf: Surf = SURF.detail,
  top = 0,
  floorH = 0,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const col = new Float32Array(n * 3);
  const sf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    sf.set([surf, top, floorH], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  g.setAttribute('surf', new THREE.BufferAttribute(sf, 3));
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Flächen aus Eckpunkten; die Drehrichtung folgt der Außenseite `out`. */
function faces(polys: { pts: THREE.Vector3[]; out: THREE.Vector3 }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const { pts, out } of polys) {
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[0]!;
      let b = pts[i]!;
      let c = pts[i + 1]!;
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      if (ab.cross(ac).dot(out) < 0) [b, c] = [c, b];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// --- Material ------------------------------------------------------------------------------

const HOUSE_GLSL = /* glsl */ `
varying vec3 vHPos;
varying vec3 vHNorm;
varying vec3 vSurf;
varying vec3 vWPos;
varying vec3 vWNorm;
varying float vHSeed;
uniform float uNight;
${NOISE_GLSL}

// Muster zur Mitte hin ausblenden, wenn es kleiner als ein Pixel wird (gegen Flimmern)
float aaFade(vec2 q) {
  vec2 fw = fwidth(q);
  return 1.0 - smoothstep(0.2, 0.55, max(fw.x, fw.y));
}

vec3 bricks(float u, float y) {
  vec2 b = vec2(u / 0.26 + floor(y / 0.12) * 0.5, y / 0.12);
  vec2 f = fract(b);
  float joint = step(0.08, f.x) * step(0.16, f.y);
  vec3 brick = vec3(0.34, 0.1, 0.05) * (0.7 + 0.6 * hash12(floor(b)));
  return mix(vec3(0.4, 0.38, 0.34), brick, mix(0.85, joint, aaFade(b)));
}

vec3 plaster(vec3 col, float u, float y, float top, float seed) {
  // Putzstruktur und große, unregelmäßige Flecken
  vec2 q = vec2(u, y);
  float fine = vnoise(q * 6.0) * 0.6 + vnoise(q * 17.0) * 0.4;
  col *= mix(1.0, 0.93 + 0.1 * fine, aaFade(q * 17.0));
  col *= 0.89 + 0.15 * vnoise(q * 0.45 + seed * 17.0);
  // Regenspuren von der Traufe herunter
  float lane = vnoise(vec2(u * 2.4 + seed * 31.0, 0.5));
  float streak = smoothstep(0.55, 0.85, lane) * smoothstep(top - 3.8, top - 0.3, y)
    * (0.45 + 0.55 * vnoise(vec2(u * 2.4, y * 0.6)));
  col *= 1.0 - 0.2 * streak;
  // Schatten unter der Traufe
  col *= 1.0 - 0.22 * smoothstep(top - 0.8, top, y);
  // Abgeplatzter Putz mit Ziegeln darunter (nicht an jedem Haus)
  if (seed > 0.55) {
    float pn = vnoise(q * 0.7 + seed * 41.0) * 0.75 + vnoise(q * 3.5) * 0.25;
    float inside = step(0.9, y) * step(y, top - 0.7);
    float patchMask = smoothstep(0.775, 0.785, pn) * inside;
    col *= 1.0 - 0.22 * smoothstep(0.74, 0.775, pn) * (1.0 - patchMask) * inside;
    col = mix(col, bricks(u, y), patchMask);
  }
  // Spritzwasser und Schmutz am Sockel, leicht grünlich
  float edge = 1.2 + 0.8 * vnoise(vec2(u * 1.7, seed * 9.0));
  float base = 1.0 - smoothstep(0.5, edge, y);
  col = mix(col, col * vec3(0.7, 0.72, 0.62), base * (0.55 + 0.35 * seed));
  return col;
}

vec3 timber(vec3 col, float u, float y, float floorH, float seed) {
  float fy = y - floorH;
  if (fy < 0.0) return col;
  float level = floor(fy / floorH);
  float ly = fy - level * floorH;
  float pw = 1.15;
  float cu = u / pw + 0.5;
  float lx = fract(cu) * pw;
  float bw = 0.09;
  float beam = 1.0 - step(bw * 2.0, ly);                  // Schwelle
  beam = max(beam, step(floorH - bw, ly));                // Rähm
  beam = max(beam, 1.0 - step(bw, min(lx, pw - lx)));     // Ständer
  beam = max(beam, 1.0 - step(bw * 0.8, abs(ly - 0.85))); // Brüstungsriegel
  float h = hash12(vec2(floor(cu), level) + seed * 7.0);
  if (h < 0.4) {
    // Strebe, mal steigend, mal fallend
    float sx = h < 0.2 ? lx : pw - lx;
    float dist = abs(sx * floorH - ly * pw) / length(vec2(pw, floorH));
    beam = max(beam, 1.0 - step(bw, dist));
  }
  vec3 wood = vec3(0.07, 0.038, 0.02) * (0.75 + 0.5 * vnoise(vec2(u * 3.0, y * 9.0)));
  float fade = aaFade(vec2(cu * 6.0, ly * 6.0));
  return mix(col * 1.06, wood, mix(0.3, beam, fade));
}

vec3 roofTiles(vec3 col, float u, float y, float top, float seed) {
  vec2 t = vec2(u * 3.4, y * 3.8);
  float row = floor(t.y);
  t.x += row * 0.5;
  vec2 f = fract(t);
  float v = hash12(floor(t) + seed * 13.0);
  // Unterkante der darüberliegenden Reihe wirft Schatten, Ziegel sind gewölbt
  float shade = (1.0 - 0.4 * smoothstep(0.6, 1.0, f.y)) * (0.84 + 0.32 * v);
  shade *= 0.82 + 0.18 * sin(f.x * 3.14159);
  col *= mix(0.88, shade, aaFade(t));
  col *= 0.86 + 0.22 * vnoise(vec2(u, y) * 0.7 + seed * 5.0);
  // Moos auf der Nordseite (−z) und dunkle Streifen zum First
  float north = smoothstep(-0.1, 0.5, -vWNorm.z) * step(0.3, seed);
  float m = vnoise(vec2(u, y) * 1.6 + seed * 3.0) + 0.3 * vnoise(vec2(u, y) * 6.0);
  float moss = north * smoothstep(0.84, 1.05, m);
  col = mix(col, vec3(0.12, 0.16, 0.04) * (0.8 + 0.4 * v), moss * 0.7);
  col *= 1.0 - 0.18 * smoothstep(top - 0.6, top, y);
  return col;
}

vec3 stone(vec3 col, float u, float y, float seed) {
  vec2 b = vec2(u / 0.55 + floor(y / 0.28) * 0.5, y / 0.28);
  vec2 f = fract(b);
  float joint = step(0.04, f.x) * step(0.08, f.y);
  float v = hash12(floor(b) + seed);
  col *= mix(0.9, mix(0.68, 0.84 + 0.26 * v, joint), aaFade(b));
  col *= 0.9 + 0.15 * vnoise(vec2(u, y) * 3.0);
  return col;
}

vec3 woodBoards(vec3 col, float u, float y, float seed) {
  float b = u / 0.24;
  float f = fract(b);
  float v = hash12(vec2(floor(b), seed * 11.0));
  float grain = vnoise(vec2(u * 30.0, y * 1.2));
  float boards = (0.82 + 0.3 * v) * (0.88 + 0.18 * grain) * mix(0.55, 1.0, step(0.07, f));
  col *= mix(0.92, boards, aaFade(vec2(b, 0.0)));
  col *= 1.0 - 0.25 * (1.0 - smoothstep(0.2, 1.2, y));
  return col;
}

vec3 glassSurface(vec3 col, float u, float y, float seed) {
  vec3 n = normalize(vWNorm);
  vec3 v = normalize(cameraPosition - vWPos);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(vec3(0.6, 0.72, 0.85), vec3(0.2, 0.36, 0.62), clamp(r.y * 1.5, 0.0, 1.0));
  vec3 refl = r.y > -0.05 ? sky : vec3(0.07, 0.08, 0.06);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.5);
  // Schräger Lichtreflex
  float s = fract((u + y) * 0.45 + seed * 3.0);
  float sheen = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.08, 0.14, s));
  return mix(col, refl, 0.2 + 0.6 * fres) + sheen * 0.05;
}

// Pflaster in Weltkoordinaten (Vorplätze), Steine in versetzten Reihen
vec3 paving(vec3 col, vec2 xz) {
  vec2 b = vec2(xz.x / 0.32 + floor(xz.y / 0.26) * 0.5, xz.y / 0.26);
  vec2 f = fract(b);
  float joint = smoothstep(0.0, 0.1, f.x) * smoothstep(1.0, 0.9, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
  float v = hash12(floor(b));
  col *= mix(0.9, mix(0.66, 0.86 + 0.26 * v, joint), aaFade(b));
  col *= 0.88 + 0.18 * vnoise(xz * 0.35);
  // Moos in den Fugen hier und da
  col = mix(col, vec3(0.2, 0.26, 0.1), (1.0 - joint) * smoothstep(0.6, 0.85, vnoise(xz * 0.8)) * 0.6 * aaFade(b));
  return col;
}

// Nachts: Lampen und ein Teil der Fenster leuchten warm (Glas: surf.z ist eine Zufallszahl je Fenster)
vec3 houseGlow() {
  if (uNight <= 0.0) return vec3(0.0);
  float kind = floor(vSurf.x + 0.5);
  // Lampen: surf.z = Helligkeit (0 = voll), Schaufenster leuchten gedämpfter
  if (kind > 7.5) return vec3(1.0, 0.78, 0.45) * (vSurf.z > 0.0 ? vSurf.z : 1.4) * uNight;
  if (kind > 5.5 && kind < 6.5 && vSurf.z < ${LIT_WINDOWS.toFixed(2)}) {
    float k = vSurf.z / ${LIT_WINDOWS.toFixed(2)};
    return mix(vec3(0.95, 0.55, 0.22), vec3(1.0, 0.75, 0.42), k) * (0.3 + 0.35 * k) * uNight;
  }
  return vec3(0.0);
}

vec3 houseSurface(vec3 col) {
  float kind = floor(vSurf.x + 0.5);
  if (kind > 7.5) return col;
  if (kind < 0.5) return col;
  #ifdef HOUSE_PLAIN
    // Einfache Stufe: nur glatte Farben, Glas leicht aufgehellt
    return kind > 5.5 && kind < 6.5 ? col * 1.3 : col;
  #endif
  vec3 n = normalize(vHNorm);
  float u = abs(n.x) > abs(n.z) ? vHPos.z : vHPos.x;
  float y = vHPos.y;
  if (kind < 1.5) return plaster(col, u, y, vSurf.y, vHSeed);
  if (kind < 2.5) return roofTiles(col, u, y, vSurf.y, vHSeed);
  if (kind < 3.5) return stone(col, u, y, vHSeed);
  if (kind < 4.5) return timber(plaster(col, u, y, vSurf.y, vHSeed), u, y, vSurf.z, vHSeed);
  if (kind < 5.5) return woodBoards(col, u, y, vHSeed);
  if (kind < 6.5) return glassSurface(col, u, y, vHSeed);
  return paving(col, vWPos.xz);
}
`;

/**
 * Lambert mit Vertexfarben. Die Instanzfarbe tönt nur Teile mit tint = 1, die
 * Oberflächen (Putz, Ziegel, Fachwerk, Holz, Glas) entstehen im Shader.
 */
export function houseMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.defines = {};
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float tint;
        attribute vec3 surf;
        varying vec3 vHPos;
        varying vec3 vHNorm;
        varying vec3 vSurf;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        varying float vHSeed;`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, tint);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vHPos = position;
        vHNorm = normal;
        vSurf = surf;
        vec4 hWorld = vec4(position, 1.0);
        mat3 hRot = mat3(modelMatrix);
        vHSeed = 0.37;
        #ifdef USE_INSTANCING
          hWorld = instanceMatrix * hWorld;
          hRot = hRot * mat3(instanceMatrix);
          vHSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #endif
        vWPos = (modelMatrix * hWorld).xyz;
        vWNorm = normalize(hRot * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HOUSE_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = houseSurface(diffuseColor.rgb);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += houseGlow();');
    shader.uniforms.uNight = NIGHT_GLOW;
  };
  mat.customProgramCacheKey = () => 'house-surface';
  return mat;
}

/** Früherer Name, für getönte Kleinteile ohne Oberfläche (z. B. Blumen am Weg). */
export const tintedMaterial = houseMaterial;

let shared: THREE.MeshLambertMaterial | null = null;
/** Ein Material für alle Häuser, damit die Grafikstufe es an einer Stelle umschalten kann. */
export function sharedHouseMaterial(): THREE.MeshLambertMaterial {
  return (shared ??= houseMaterial());
}

/** Oberflächen (Putz, Ziegel, Fachwerk …) ein- oder ausschalten. */
export function setHouseSurfaces(on: boolean): void {
  const m = sharedHouseMaterial();
  const plain = 'HOUSE_PLAIN' in m.defines!;
  if (plain === !on) return;
  if (on) delete m.defines!.HOUSE_PLAIN;
  else m.defines!.HOUSE_PLAIN = '';
  m.needsUpdate = true;
}

// --- Farben ------------------------------------------------------------------------------

const ROOFS = ['#b5523b', '#9c4a36', '#7a4b3a', '#5b5f66', '#a8613f', '#8c3f30', '#b8664a', '#6e4436'];
const DOORS = ['#6b4226', '#2f5d50', '#3b5b8a', '#8a2f2f', '#5a4632', '#4f6b3a', '#7a6a4f'];
const SHUTTERS = ['#3f6e4a', '#2f5d8a', '#8a5a2f', '#7a2f2f', '#5d6b73', '#4b7a72'];
const FRAMES = ['#f4efe4', '#efe6d2', '#6b4a32', '#e9e4da'];
const FLOWERS = ['#e63946', '#ff8fab', '#ffffff', '#ffd23f', '#9b5de5', '#f77f00'];
const GLASS = ['#3a4a5c', '#34495e', '#3d5266', '#45505a'];
const CURTAINS = ['#f4efe4', '#e9dcc0', '#d9e2e6', '#f0d9c8', '#c9b79a'];
const STONE_COLOR = '#c9c1b0';
const ZINC = '#8d9294';
const IVY = ['#3f6e2e', '#4f7f34', '#365f28', '#5a8a3a'];
const DARK_WOOD = '#4a3020';

interface WindowStyle {
  w: number;
  h: number;
  frame: string;
  glass: string;
  bars: boolean;
  shutters: string | null;
  boxes: boolean;
  /** Steinsturz über dem Fenster. */
  lintel: boolean;
}

/**
 * Ein Fenster auf einer Wand. Lokale Lage: Mitte (x, y), Wand bei z = 0, außen = +z.
 * @param front Vorderseite: Läden und Blumenkästen nur dort
 */
function windowParts(s: WindowStyle, rng: Rng, front: boolean): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const { w, h } = s;
  p.push(part(box(w + 0.18, h + 0.18, 0.06, 0, 0, 0.03), s.frame));
  // Jede Scheibe etwas anders hell: dahinter liegen verschiedene Zimmer
  p.push(part(box(w, h, 0.06, 0, 0, 0.05), new THREE.Color(s.glass).multiplyScalar(0.6 + rng() * 0.8), 0, SURF.glass, 0, rng()));
  if (s.bars) {
    p.push(part(box(0.06, h, 0.04, 0, 0, 0.09), s.frame));
    p.push(part(box(w, 0.06, 0.04, 0, h * 0.12, 0.09), s.frame));
  }
  // Vorhänge: mal ein Volant oben, mal seitliche Schals
  const c = rng();
  if (c < 0.3) p.push(part(box(w * 0.96, h * 0.22, 0.02, 0, h * 0.38, 0.085), pick(rng, CURTAINS)));
  else if (c < 0.5) {
    const col = pick(rng, CURTAINS);
    for (const side of [-1, 1]) p.push(part(box(w * 0.2, h * 0.94, 0.02, side * w * 0.39, 0, 0.085), col));
  }
  // Fensterbank, Sturz
  p.push(part(box(w + 0.3, 0.08, 0.22, 0, -h / 2 - 0.1, 0.1), '#d8d2c4', 0, SURF.stone));
  if (s.lintel) p.push(part(box(w + 0.36, 0.16, 0.05, 0, h / 2 + 0.17, 0.025), STONE_COLOR, 0, SURF.stone));
  if (front && s.shutters) {
    for (const side of [-1, 1]) {
      p.push(part(box(w * 0.5, h + 0.1, 0.05, side * (w * 0.75 + 0.12), 0, 0.04), s.shutters, 0, SURF.wood));
      for (const yy of [-h * 0.25, h * 0.25]) {
        p.push(part(box(w * 0.5, 0.05, 0.03, side * (w * 0.75 + 0.12), yy, 0.08), s.shutters));
      }
    }
  }
  if (front && s.boxes) {
    // Blumenkasten unter der Bank, darin Blätter und Blüten
    const bw = w + 0.1;
    p.push(part(box(bw, 0.24, 0.28, 0, -h / 2 - 0.28, 0.2), '#7a4e2d', 0, SURF.wood));
    p.push(part(new THREE.IcosahedronGeometry(0.16, 0).scale(bw * 3, 1, 1.2).translate(0, -h / 2 - 0.08, 0.2), '#4f8a3a'));
    const n = 3 + Math.floor(rng() * 3);
    const c1 = pick(rng, FLOWERS);
    const c2 = pick(rng, FLOWERS);
    for (let k = 0; k < n; k++) {
      const x = -bw / 2 + 0.15 + (k / Math.max(1, n - 1)) * (bw - 0.3);
      p.push(part(new THREE.IcosahedronGeometry(0.1 + rng() * 0.04, 0).translate(x, -h / 2 + 0.02 + rng() * 0.06, 0.22 + rng() * 0.06), k % 2 ? c1 : c2));
    }
    // Hängende Ranken
    if (rng() < 0.5) {
      for (let k = 0; k < 2; k++) {
        const x = (k ? 1 : -1) * bw * 0.3;
        p.push(part(new THREE.IcosahedronGeometry(0.1, 0).scale(1, 2.4, 0.8).translate(x, -h / 2 - 0.5, 0.33), '#4f8a3a'));
      }
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
  p.push(part(box(w + 0.24, h + 0.14, 0.06, 0, h / 2 + 0.05, 0.03), s.frame, 0, s.frame === STONE_COLOR ? SURF.stone : SURF.detail));
  p.push(part(box(w, h, 0.08, 0, h / 2, 0.06), s.color, 0, SURF.wood));
  if (s.kind === 'double') p.push(part(box(0.05, h, 0.04, 0, h / 2, 0.11), s.frame));
  if (s.kind === 'glass') {
    p.push(part(box(w * 0.6, h * 0.35, 0.04, 0, h * 0.72, 0.11), '#4a5f73', 0, SURF.glass, 0, rng()));
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
    p.push(part(box(w + 0.9, 0.12, 1.0, 0, h + 0.45, 0.5), '#7a4b3a', 0, SURF.roof, h + 0.5));
    for (const side of [-1, 1]) p.push(part(box(0.08, 0.4, 0.8, side * (w / 2 + 0.3), h + 0.22, 0.4), '#5a3a24'));
  }
  // Klinke, Stufe
  p.push(part(box(0.06, 0.06, 0.08, w * 0.35, h * 0.48, 0.14), '#c9b037'));
  p.push(part(box(w + 0.8, 0.3, 0.8, 0, 0.15, 0.4), '#b9b2a4', 0, SURF.stone));
  // Wandleuchte oder Hausnummer, manchmal ein Briefkasten
  if (rng() < 0.5) p.push(part(box(0.18, 0.26, 0.16, w / 2 + 0.45, h * 0.8, 0.1), '#2b2b2b'), part(box(0.12, 0.16, 0.12, w / 2 + 0.45, h * 0.78, 0.17), '#fff2c4', 0, SURF.light));
  else p.push(part(box(0.3, 0.22, 0.03, -(w / 2 + 0.4), h * 0.8, 0.03), '#2f5d8a'));
  if (rng() < 0.5) p.push(part(box(0.34, 0.42, 0.16, -(w / 2 + 0.45), 1.15, 0.08), pick(rng, ['#d4a017', '#2b2b2b', '#3f6e4a', '#8a2f2f'])));
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

/** Schaufenster eines Ladens im Modell (Mitte x, Breite, Unterkante, Oberkante). */
export interface ShopWindow {
  x: number;
  width: number;
  bottom: number;
  top: number;
}

/**
 * Schaufenster mit hellem Innenraum (wirkt beleuchtet), Rahmen und Sockel.
 * Auslage, Markise und Schild kommen je nach Ladenart dazu (shopFronts.ts).
 */
function shopWindowParts(win: ShopWindow, wallZ: number): THREE.BufferGeometry[] {
  const { x, width, bottom, top } = win;
  const h = top - bottom;
  const y = (top + bottom) / 2;
  return [
    part(box(width + 0.3, h + 0.3, 0.08, x, y, wallZ + 0.04), '#3b3f45'),
    part(box(width, h, 0.06, x, y, wallZ + 0.09), '#e8dcc0', 0, SURF.light, 0, 0.45),
    part(box(0.08, h, 0.05, x, y, wallZ + 0.14), '#3b3f45'),
    part(box(width + 0.4, 0.5, 0.2, x, bottom - 0.25, wallZ + 0.1), '#7d766b', 0, SURF.stone),
  ];
}

// --- Dächer ----------------------------------------------------------------------------------

interface RoofSpec {
  /** Grundfläche unter dem Dach (Wandaußenmaß). */
  w: number;
  d: number;
  eave: number;
  rise: number;
  /** Überstand an der Traufe und am Ortgang. */
  oh: number;
  color: string;
  /** Giebelfläche: Putz, Fachwerk oder Holz. */
  gable: Surf;
  floorH: number;
  /** Feste Giebelfarbe (sonst Wandfarbe des Hauses). */
  gableColor?: string;
}

/** Regenrinne an der Traufe (Länge entlang x, bei z) und Fallrohr bis zum Sockel. */
function gutter(len: number, y: number, z: number, pipeX: number | null, wallZ: number): THREE.BufferGeometry[] {
  const p = [part(box(len, 0.14, 0.16, 0, y - 0.05, z), ZINC)];
  if (pipeX !== null) {
    p.push(part(box(0.1, 0.1, z - wallZ, pipeX, y - 0.15, (z + wallZ) / 2), ZINC));
    p.push(part(new THREE.CylinderGeometry(0.055, 0.055, y - 0.6, 6).translate(pipeX, (y + 0.6) / 2 - 0.1, wallZ + 0.1), ZINC));
    p.push(part(box(0.14, 0.12, 0.3, pipeX, 0.62, wallZ + 0.2), ZINC));
  }
  return p;
}

/** Satteldach, First entlang x (Traufen vorn und hinten). Giebel als Wand. */
function gableRoofX(s: RoofSpec, rng: Rng, pipe: number | null): THREE.BufferGeometry[] {
  const { w, d, eave, rise, oh, color } = s;
  const half = d / 2;
  const a = Math.atan2(rise, half);
  const run = half + oh;
  const slabL = run / Math.cos(a);
  const len = w + 2 * Math.min(oh, 0.45);
  const top = eave + rise;
  const t = 0.16;
  const p: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const g = new THREE.BoxGeometry(len, t, slabL).translate(0, t / 2, slabL / 2).rotateX(a);
    if (side < 0) g.rotateY(Math.PI);
    p.push(part(g.translate(0, top, 0), color, 0, SURF.roof, top));
  }
  // Firstziegel
  p.push(part(box(len + 0.05, 0.22, 0.4, 0, top + 0.12, 0), new THREE.Color(color).multiplyScalar(0.8), 0, SURF.roof, top + 0.4));
  // Giebeldreiecke
  for (const sx of [1, -1]) {
    p.push(part(faces([{ pts: [v3(sx * w / 2, eave, -half), v3(sx * w / 2, eave, half), v3(sx * w / 2, top, 0)], out: v3(sx, 0, 0) }]), s.gableColor ?? '#ffffff', s.gableColor ? 0 : 1, s.gable, top, s.floorH));
  }
  // Traufbrett unter den Platten, Rinne vorn
  const low = eave - oh * Math.tan(a);
  p.push(part(box(len, 0.06, d + 2 * oh - 0.1, 0, low - 0.02, 0), DARK_WOOD));
  p.push(...gutter(len, low, half + oh - 0.05, pipe, half));
  if (rng() < 0.5) p.push(...gutter(len, low, -(half + oh - 0.05), null, -half));
  return p;
}

/** Walmdach (oder Zeltdach bei quadratischer Grundfläche), First entlang x. */
function hipRoofX(s: RoofSpec, pipe: number | null): THREE.BufferGeometry[] {
  const { w, d, eave, rise, oh, color } = s;
  const tanA = rise / (d / 2);
  const W = w / 2 + oh;
  const D = d / 2 + oh;
  const e = eave - oh * tanA;
  const rl = Math.max(0, w / 2 - d / 2);
  const t = eave + rise;
  const A = v3(-W, e, D), B = v3(W, e, D), C = v3(W, e, -D), Dd = v3(-W, e, -D);
  const R1 = v3(-rl, t, 0), R2 = v3(rl, t, 0);
  const p = [
    part(faces([
      { pts: [A, B, R2, R1], out: v3(0, 1, 1) },
      { pts: [C, Dd, R1, R2], out: v3(0, 1, -1) },
      { pts: [B, C, R2], out: v3(1, 1, 0) },
      { pts: [Dd, A, R1], out: v3(-1, 1, 0) },
    ]), color, 0, SURF.roof, t),
    // Untersicht und Traufbrett
    part(faces([{ pts: [A, B, C, Dd], out: v3(0, -1, 0) }]), DARK_WOOD),
    part(faces([
      { pts: [A, B, v3(W, e - 0.16, D), v3(-W, e - 0.16, D)], out: v3(0, 0, 1) },
      { pts: [C, Dd, v3(-W, e - 0.16, -D), v3(W, e - 0.16, -D)], out: v3(0, 0, -1) },
      { pts: [B, C, v3(W, e - 0.16, -D), v3(W, e - 0.16, D)], out: v3(1, 0, 0) },
      { pts: [Dd, A, v3(-W, e - 0.16, D), v3(-W, e - 0.16, -D)], out: v3(-1, 0, 0) },
    ]), '#efe6d2'),
  ];
  if (rl > 0) p.push(part(box(2 * rl + 0.1, 0.2, 0.36, 0, t + 0.08, 0), new THREE.Color(color).multiplyScalar(0.8), 0, SURF.roof, t + 0.3));
  p.push(...gutter(2 * W, e, D - 0.05, pipe, d / 2));
  return p;
}

/** Dachgaube auf der vorderen Dachfläche (First entlang x). */
function dormer(s: RoofSpec, x: number, win: WindowStyle, rng: Rng): THREE.BufferGeometry[] {
  const half = s.d / 2;
  const zf = half - 0.9;
  const yb = s.eave + s.rise * (1 - zf / half) - 0.15;
  const bw = 1.5;
  const bh = 1.3;
  const depth = 1.8;
  const p: THREE.BufferGeometry[] = [
    part(box(bw, bh, depth, x, yb + bh / 2, zf - depth / 2), '#ffffff', 1, SURF.plaster, yb + bh),
  ];
  const mini: RoofSpec = { ...s, w: depth, d: bw, eave: yb + bh, rise: 0.6, oh: 0.15 };
  p.push(...gableRoofX(mini, rng, null).map((g) => g.rotateY(Math.PI / 2).translate(x, 0, zf - depth / 2)));
  p.push(...onWall(windowParts({ ...win, w: 0.7, h: 0.75, shutters: null, boxes: false, lintel: false }, rng, false), x, yb + bh / 2 + 0.05, zf, 0));
  return p;
}

// --- Wände und Schmuck ------------------------------------------------------------------------

/** Eckquader an den senkrechten Kanten (abwechselnd lang und kurz). */
function quoins(w: number, d: number, h: number, corners: [number, number][]): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const course = 0.36;
  for (const [sx, sz] of corners) {
    for (let k = 0, y = 0.6; y + course <= h - 0.2; k++, y += course) {
      const [lx, lz] = k % 2 ? [0.6, 0.32] : [0.32, 0.6];
      p.push(part(box(lx, course - 0.04, lz, sx * (w / 2 - lx / 2 + 0.025), y + course / 2, sz * (d / 2 - lz / 2 + 0.025)), STONE_COLOR, 0, SURF.stone));
    }
  }
  return p;
}

/** Efeu an einer Seitenwand (x = side · w/2), unten dicht, nach oben lockerer. */
function ivy(w: number, h: number, side: number, rng: Rng, zCenter: number): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const width = 2 + rng() * 2.5;
  const height = h * (0.45 + rng() * 0.45);
  const n = 50 + Math.floor(width * height * 3);
  for (let k = 0; k < n; k++) {
    const yr = Math.pow(rng(), 0.8);
    const z = zCenter + (rng() - 0.5) * width * (1 - yr * 0.55);
    const r = 0.18 + rng() * 0.14;
    p.push(part(new THREE.IcosahedronGeometry(r, 0).scale(0.45, 1, 1).translate(side * (w / 2 + 0.06), 0.3 + yr * height, z), pick(rng, IVY)));
  }
  return p;
}

/** Bank aus Holz an der Wand. */
function bench(x: number, z: number): THREE.BufferGeometry[] {
  return [
    part(box(1.5, 0.08, 0.42, x, 0.78, z + 0.25), '#8a6240', 0, SURF.wood),
    part(box(1.5, 0.36, 0.06, x, 1.12, z + 0.06), '#8a6240', 0, SURF.wood),
    ...[-0.62, 0.62].map((dx) => part(box(0.08, 0.48, 0.38, x + dx, 0.54, z + 0.25), '#5a3a24')),
  ];
}

/** Balkon mit Gitter vor einem Geschoss (Boden bei y, Vorderwand bei z). */
function balcony(width: number, y: number, z: number, rng: Rng): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [part(box(width, 0.16, 0.95, 0, y, z + 0.47), '#d8d2c4', 0, SURF.stone)];
  for (const yy of [y + 0.15, y + 1.0]) p.push(part(box(width, 0.05, 0.05, 0, yy, z + 0.92), '#2b2b2b'));
  for (const sx of [-1, 1]) p.push(part(box(0.05, 0.05, 0.9, sx * (width / 2 - 0.03), y + 1.0, z + 0.47), '#2b2b2b'));
  for (let x = -width / 2 + 0.06; x <= width / 2; x += 0.14) p.push(part(box(0.025, 0.85, 0.025, x, y + 0.58, z + 0.92), '#2b2b2b'));
  for (let k = 0; k < 4; k++) p.push(part(box(0.025, 0.85, 0.025, (k % 2 ? 1 : -1) * (width / 2 - 0.03), y + 0.58, z + 0.2 + (k >> 1) * 0.35), '#2b2b2b'));
  if (rng() < 0.6) {
    // Blumen am Geländer
    p.push(part(box(width * 0.4, 0.2, 0.22, -width * 0.2, y + 1.12, z + 0.98), '#7a4e2d', 0, SURF.wood));
    for (let k = 0; k < 4; k++) p.push(part(new THREE.IcosahedronGeometry(0.12, 0).translate(-width * 0.35 + k * width * 0.1, y + 1.3, z + 1.0), pick(rng, FLOWERS)));
  }
  return p;
}

// --- Varianten -----------------------------------------------------------------------------------

export interface HouseVariant {
  geometry: THREE.BufferGeometry;
  /** Vereinfachtes Modell für die Ferne. */
  far: THREE.BufferGeometry;
  /** Türmitte (x) und Vorderkante der Stufe (z) im Modell. */
  door: { x: number; z: number };
  kind: 'house' | 'townhouse';
  /** Vorderwand bei z. */
  front: number;
  /** Außenmaße der Grundfläche. */
  width: number;
  depth: number;
  /** Nur bei Ladenvarianten. */
  shop?: ShopWindow;
}

/** Breiten der Stadthäuser in m (für geschlossene Häuserzeilen). */
export const TOWNHOUSE_WIDTHS = [5, 6, 7, 8] as const;
/** Tiefe der Stadthäuser in m. */
export const TOWNHOUSE_DEPTH = 9;

function windowStyle(rng: Rng, sizes: { w: number[]; h: number[] }, shutterChance: number, boxChance: number): WindowStyle {
  return {
    w: pick(rng, sizes.w),
    h: pick(rng, sizes.h),
    frame: pick(rng, FRAMES),
    glass: pick(rng, GLASS),
    bars: rng() < 0.65,
    shutters: rng() < shutterChance ? pick(rng, SHUTTERS) : null,
    boxes: rng() < boxChance,
    lintel: rng() < 0.4,
  };
}

/** Wohnhaus: zwei Geschosse, Walm- oder Satteldach, manchmal Fachwerk im Obergeschoss. */
function houseVariant(rng: Rng, shop = false): HouseVariant {
  const w = 8, d = 7, floors = 2, floorH = 2.5;
  const h = floors * floorH;
  const roofColor = pick(rng, ROOFS);
  const timber = !shop && rng() < 0.3;
  const jetty = timber ? 0.15 : 0;
  const parts: THREE.BufferGeometry[] = [part(box(w + 0.1, 0.5, d + 0.1, 0, 0.25, 0), '#a39a8c', 0, SURF.stone)];
  if (timber) {
    parts.push(part(box(w, floorH, d, 0, floorH / 2, 0), '#ffffff', 1, SURF.plaster, floorH, floorH));
    parts.push(part(box(w + 2 * jetty, h - floorH, d + 2 * jetty, 0, (h + floorH) / 2, 0), '#ffffff', 1, SURF.timber, h, floorH));
    parts.push(part(box(w + 2 * jetty + 0.04, 0.2, d + 2 * jetty + 0.04, 0, floorH + 0.08, 0), DARK_WOOD));
  } else {
    parts.push(part(box(w, h, d, 0, h / 2, 0), '#ffffff', 1, SURF.plaster, h, floorH));
    if (rng() < 0.35) parts.push(...quoins(w, d, h, [[1, 1], [-1, 1], [1, -1], [-1, -1]]));
  }
  const wt = w + 2 * jetty;
  const dt = d + 2 * jetty;

  const roofKind = pick(rng, ['hip', 'hip', 'gable', 'gableFront'] as const);
  const pipe = (rng() < 0.5 ? 1 : -1) * (wt / 2 - 0.15);
  const spec: RoofSpec = { w: wt, d: dt, eave: h, rise: 0, oh: 0.6, color: roofColor, gable: timber ? SURF.timber : SURF.plaster, floorH };
  if (roofKind === 'gableFront') {
    // Giebel zur Straße: Dach um 90° gedreht
    const r: RoofSpec = { ...spec, w: dt, d: wt, rise: wt / 2 * 0.85 };
    parts.push(...gableRoofX(r, rng, null).map((g) => g.rotateY(Math.PI / 2)));
    parts.push(...onWall(windowParts({ ...windowStyle(rng, { w: [0.7], h: [0.8] }, 0, 0), shutters: null }, rng, false), 0, h + r.rise * 0.38, dt / 2, 0));
  } else {
    spec.rise = roofKind === 'hip' ? 2.8 : dt / 2 * 0.9;
    parts.push(...(roofKind === 'hip' ? hipRoofX(spec, pipe) : gableRoofX(spec, rng, pipe)));
  }
  const ridge = h + (roofKind === 'gableFront' ? wt / 2 * 0.85 : spec.rise);
  // Schornstein mit Abdeckung
  if (rng() < 0.85) {
    const cx = (rng() < 0.5 ? 1 : -1) * 1.8;
    parts.push(part(box(0.7, ridge - h + 0.6, 0.7, cx, (ridge + h) / 2 + 0.3, -0.6), '#9a8f84', 0, SURF.stone));
    parts.push(part(box(0.86, 0.12, 0.86, cx, ridge + 0.66, -0.6), '#6d6760'));
  }

  const win = windowStyle(rng, { w: [0.9, 1.0, 0.8], h: [1.1, 1.3, 1.0] }, 0.5, 0.6);
  if (roofKind !== 'gableFront' && rng() < 0.45) parts.push(...dormer(spec, 0, win, rng));
  const door: DoorStyle = { kind: pick(rng, ['canopy', 'arch', 'double', 'glass'] as const), color: pick(rng, DOORS), frame: pick(rng, [...FRAMES.slice(0, 2), STONE_COLOR]) };
  // Laden: Tür rechts, links ein breites Schaufenster
  const doorX = shop ? w / 2 - 1.4 : pick(rng, [0, 0, -w / 4, w / 4]);
  const shopWin: ShopWindow | undefined = shop ? { x: -0.9, width: 4.2, bottom: 0.75, top: 2.15 } : undefined;
  if (shopWin) parts.push(...shopWindowParts(shopWin, d / 2));

  parts.push(...onWall(doorParts(door, rng), doorX, 0, d / 2, 0));
  for (let f = 0; f < floors; f++) {
    const y = f * floorH + floorH * 0.62;
    const off = f > 0 ? jetty : 0;
    for (const x of [-w / 3, 0, w / 3]) {
      // Vorderseite: Erdgeschoss neben der Tür (und beim Laden ganz) frei lassen
      if (!(f === 0 && (shop || Math.abs(x - doorX) < 1.6)) && !(x === 0 && f === 0)) {
        parts.push(...onWall(windowParts(win, rng, true), x, y, d / 2 + off, 0));
      }
      if (x !== 0) parts.push(...onWall(windowParts(win, rng, false), x, y, -d / 2 - off, Math.PI));
    }
    for (const side of [1, -1]) parts.push(...onWall(windowParts(win, rng, false), side * (w / 2 + off), y, 0, side * Math.PI / 2));
  }
  // Leben am Haus: Efeu an einer Seite, Bank neben der Tür
  if (rng() < 0.3) parts.push(...ivy(w + 2 * jetty, h, rng() < 0.5 ? 1 : -1, rng, (rng() - 0.5) * 3));
  if (!shop && rng() < 0.35) {
    const bx = doorX <= 0 ? doorX + 2.2 : doorX - 2.2;
    if (Math.abs(bx) < w / 2 - 0.8) parts.push(...bench(bx, d / 2));
  }
  return { ...withFar(parts), door: { x: doorX, z: d / 2 + 0.8 }, kind: 'house', front: d / 2, width: w, depth: d, shop: shopWin };
}

/**
 * Stadthaus für Häuserzeilen: Breite fest, zwei bis vier Geschosse, Trauf- oder
 * Giebelseite zur Straße, Gesimse, manchmal Balkon, Eckquader oder Fachwerk.
 */
function townhouseVariant(rng: Rng, w: number, shop = false): HouseVariant {
  const d = TOWNHOUSE_DEPTH, floorH = 2.8;
  const floors = pick(rng, [2, 3, 3, 3, 4]);
  const h = floors * floorH + 0.3;
  const roofColor = pick(rng, ROOFS);
  const timber = !shop && floors <= 3 && rng() < 0.15;
  const parts: THREE.BufferGeometry[] = [
    part(box(w + 0.1, 0.6, d + 0.1, 0, 0.3, 0), '#9d968a', 0, SURF.stone),
    part(box(w, h, d, 0, h / 2, 0), '#ffffff', 1, timber ? SURF.timber : SURF.plaster, h, floorH),
  ];
  // Gesimse über dem Erdgeschoss und unter dem Dach (vorn und hinten)
  if (!timber) {
    for (const sz of [1, -1]) parts.push(part(box(w + 0.02, 0.16, 0.14, 0, floorH * 1.02, sz * (d / 2 + 0.05)), '#e4ded0', 0, SURF.stone));
  }
  if (!timber && rng() < 0.4) parts.push(...quoins(w, d, h, [[1, 1], [-1, 1]]));
  // Sockelzone im Erdgeschoss manchmal abgesetzt (dunklerer Putz)
  if (!timber && rng() < 0.35) {
    parts.push(part(box(w + 0.03, floorH - 0.6, 0.03, 0, 0.6 + (floorH - 0.6) / 2, d / 2 + 0.01), new THREE.Color('#ffffff').multiplyScalar(0.82), 1, SURF.plaster, floorH, floorH));
  }

  const roofKind = w <= 6 && rng() < 0.4 ? 'gableFront' : rng() < 0.85 ? 'gable' : 'hip';
  const pipe = (rng() < 0.5 ? 1 : -1) * (w / 2 - 0.15);
  const spec: RoofSpec = { w, d, eave: h, rise: 0, oh: 0.5, color: roofColor, gable: timber ? SURF.timber : SURF.plaster, floorH };
  let ridge: number;
  if (roofKind === 'gableFront') {
    const r: RoofSpec = { ...spec, w: d, d: w, rise: w / 2 * 1.1, oh: 0.35 };
    parts.push(...gableRoofX(r, rng, null).map((g) => g.rotateY(Math.PI / 2)));
    parts.push(part(box(w + 0.2, 0.22, 0.2, 0, h + 0.02, d / 2 + 0.06), '#e4ded0', 0, SURF.stone));
    // Fenster im Giebel
    const gw = windowStyle(rng, { w: [0.7, 0.8], h: [0.9] }, 0, 0);
    parts.push(...onWall(windowParts({ ...gw, shutters: null }, rng, false), 0, h + r.rise * 0.35, d / 2, 0));
    ridge = h + r.rise;
  } else {
    spec.rise = roofKind === 'hip' ? 3 : d / 2 * pick(rng, [0.7, 0.8, 0.95]);
    if (roofKind === 'hip') {
      // Ziegelhaus mit Walmdach: First quer zur Straße, weil das Haus tiefer als breit ist
      const r: RoofSpec = { ...spec, w: d, d: w, rise: w / 2 * 0.9 };
      parts.push(...hipRoofX(r, null).map((g) => g.rotateY(Math.PI / 2)));
      ridge = h + r.rise;
    } else {
      parts.push(part(box(w + 0.1, 0.26, 0.3, 0, h - 0.1, d / 2 + 0.1), '#e4ded0', 0, SURF.stone));
      parts.push(...gableRoofX(spec, rng, pipe));
      ridge = h + spec.rise;
    }
  }
  if (rng() < 0.8) {
    const cx = (rng() < 0.5 ? 1 : -1) * (w / 2 - 0.6);
    parts.push(part(box(0.6, ridge - h + 0.4, 0.8, cx, (ridge + h) / 2 + 0.2, -1.2), '#9a8f84', 0, SURF.stone));
    parts.push(part(box(0.74, 0.12, 0.94, cx, ridge + 0.46, -1.2), '#6d6760'));
  }

  const win = windowStyle(rng, { w: [0.85, 0.95], h: [1.3, 1.5] }, 0.4, 0.65);
  if (roofKind === 'gable' && rng() < 0.55) {
    const xs = w >= 7 ? [-w / 4, w / 4] : [0];
    for (const x of xs) parts.push(...dormer(spec, x, win, rng));
  }
  const door: DoorStyle = { kind: pick(rng, ['arch', 'glass', 'canopy'] as const), color: pick(rng, DOORS), frame: pick(rng, ['#efe6d2', STONE_COLOR]) };
  // Laden: großes Schaufenster, Tür seitlich
  const doorX = shop ? w / 2 - 1.1 : pick(rng, [w / 2 - 1.2, -(w / 2 - 1.2), 0]);
  const shopWidth = w - 2.7;
  const shopWin: ShopWindow | undefined = shop ? { x: -w / 2 + 0.45 + shopWidth / 2, width: shopWidth, bottom: 0.8, top: 2.3 } : undefined;
  if (shopWin) parts.push(...shopWindowParts(shopWin, d / 2));
  parts.push(...onWall(doorParts(door, rng), doorX, 0, d / 2, 0));

  const n = w <= 6 ? 2 : 3;
  const xs = Array.from({ length: n }, (_, k) => -w / 2 + (w * (k + 0.5)) / n);
  const balconyFloor = !shop && floors >= 3 && rng() < 0.35 ? 1 : -1;
  for (let f = 0; f < floors; f++) {
    const y = f * floorH + floorH * 0.6;
    for (const x of xs) {
      if (f === balconyFloor) {
        // Balkontür statt Fenster
        const doorWin: WindowStyle = { ...win, h: 2.1, boxes: false };
        parts.push(...onWall(windowParts(doorWin, rng, true), x, f * floorH + 0.2 + 1.05, d / 2, 0));
      } else if (f > 0 || (!shop && Math.abs(x - doorX) > 1.4)) {
        parts.push(...onWall(windowParts(win, rng, true), x, y, d / 2, 0));
      }
      parts.push(...onWall(windowParts(win, rng, false), x, y, -d / 2, Math.PI));
    }
    // Seitenfenster: in Zeilen meist verdeckt, am Zeilenende sichtbar
    for (const side of [1, -1]) {
      for (const z of [-d / 4, d / 4]) parts.push(...onWall(windowParts(win, rng, false), side * w / 2, y, z, side * Math.PI / 2));
    }
  }
  if (balconyFloor > 0) parts.push(...balcony(w - 1.0, balconyFloor * floorH + 0.1, d / 2, rng));
  if (rng() < 0.15) parts.push(...ivy(w, h, rng() < 0.5 ? 1 : -1, rng, d / 2 - 1.5));
  return { ...withFar(parts), door: { x: doorX, z: d / 2 + 0.8 }, kind: 'townhouse', front: d / 2, width: w, depth: d, shop: shopWin };
}

/**
 * Detailmodell und einfaches Fernmodell aus denselben Teilen: In der Ferne bleiben
 * nur große Teile (Wände, Dach, Rinnen) und die Scheiben; Rahmen, Blumen, Efeu,
 * Eckquader und Gitter fallen weg.
 */
function withFar(parts: THREE.BufferGeometry[]): { geometry: THREE.BufferGeometry; far: THREE.BufferGeometry } {
  const size = new THREE.Vector3();
  const far = parts.filter((g) => {
    g.computeBoundingBox();
    g.boundingBox!.getSize(size);
    return Math.max(size.x, size.y, size.z) >= 1.4 || g.getAttribute('surf').getX(0) === SURF.glass;
  });
  return { geometry: mergeGeometries(parts)!, far: mergeGeometries(far)! };
}

/** Scheune: breit, niedrig, Holzbretter, großes Tor, Satteldach. */
function barnVariant(rng: Rng): THREE.BufferGeometry {
  const w = 12, d = 8, h = 4.5;
  const parts: THREE.BufferGeometry[] = [
    part(box(w + 0.1, 0.4, d + 0.1, 0, 0.2, 0), '#8a8278', 0, SURF.stone),
    part(box(w, h, d, 0, h / 2, 0), '#9a6b45', 0, SURF.wood, h),
    part(box(3.4, 3.4, 0.1, 0, 1.7, d / 2 + 0.05), '#5a3a24', 0, SURF.wood),
    part(box(3.6, 0.15, 0.12, 0, 3.45, d / 2 + 0.08), '#e8e0d0'),
  ];
  // Andreaskreuz im Tor
  for (const sgn of [1, -1]) {
    parts.push(part(new THREE.BoxGeometry(4.6, 0.16, 0.06).rotateZ(sgn * Math.PI / 4).translate(0, 1.7, d / 2 + 0.12), '#e8e0d0'));
  }
  parts.push(...gableRoofX({ w, d, eave: h, rise: 3.2, oh: 0.6, color: '#6f4a32', gable: SURF.wood, floorH: 3, gableColor: '#9a6b45' }, rng, null));
  return mergeGeometries(parts)!;
}

export interface HouseVariants {
  houses: HouseVariant[];
  /** Stadthäuser, je Breite aus TOWNHOUSE_WIDTHS mehrere. */
  townhouses: HouseVariant[];
  /** Mit Ladenlokal im Erdgeschoss. */
  houseShops: HouseVariant[];
  townhouseShops: HouseVariant[];
  barn: THREE.BufferGeometry;
}

export function createHouseVariants(rng: Rng): HouseVariants {
  return {
    houses: Array.from({ length: 10 }, () => houseVariant(rng)),
    townhouses: TOWNHOUSE_WIDTHS.flatMap((w) => Array.from({ length: 3 }, () => townhouseVariant(rng, w))),
    houseShops: Array.from({ length: 3 }, () => houseVariant(rng, true)),
    townhouseShops: TOWNHOUSE_WIDTHS.map((w) => townhouseVariant(rng, w, true)),
    barn: barnVariant(rng),
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

  // Kleinkram am Weg nur in der Nähe zeigen (in Kacheln)
  const group = new THREE.Group();
  const add = (name: string, geo: THREE.BufferGeometry, items: { m: THREE.Matrix4; c: THREE.Color }[], mat: THREE.Material) => {
    if (items.length === 0) return;
    group.add(lod.add(new LodInstances({ name, near: geo, material: mat, nearDist: 110, hideDist: 110, cell: 160 },
      items.map((it) => ({ matrix: it.m, color: it.c })))).group);
  };
  const plain = new THREE.MeshLambertMaterial({ flatShading: true });
  add('trittsteine', STONE, stones, plain);
  add('kiesel', PEBBLE, pebbles, plain);
  add('wegblumen', flowerGeometry(), flowers, sharedHouseMaterial());
  return { group, lines };
}
