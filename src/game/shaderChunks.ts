import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import type { RoadNetwork } from '../world/roadNetwork';
import type { GroundData } from './terrainMesh';

/** Wertrauschen (0…1) und Hash, für Shader. */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Geländehöhe im Shader, genau wie `Heightfield.meshHeight` (gleiche Dreiecke).
 * Dazu Bodenart (Farbe + Grasanteil) und Straßenmaske.
 */
export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D tHeight;
uniform sampler2D tGround;
uniform sampler2D tRoadMask;
uniform float terrainSize;
uniform float terrainRes;

float terrainHeight(vec2 xz) {
  float cell = terrainSize / (terrainRes - 1.0);
  vec2 f = clamp((xz + terrainSize * 0.5) / cell, vec2(0.0), vec2(terrainRes - 1.0));
  ivec2 ij = ivec2(min(floor(f), vec2(terrainRes - 2.0)));
  vec2 t = f - vec2(ij);
  float h00 = texelFetch(tHeight, ij, 0).r;
  float h10 = texelFetch(tHeight, ij + ivec2(1, 0), 0).r;
  float h01 = texelFetch(tHeight, ij + ivec2(0, 1), 0).r;
  float h11 = texelFetch(tHeight, ij + ivec2(1, 1), 0).r;
  if ((ij.x + ij.y) % 2 == 0) {
    return t.x + t.y <= 1.0
      ? h00 + (h10 - h00) * t.x + (h01 - h00) * t.y
      : h11 + (h01 - h11) * (1.0 - t.x) + (h10 - h11) * (1.0 - t.y);
  }
  return t.y >= t.x
    ? h00 + (h01 - h00) * t.y + (h11 - h01) * t.x
    : h00 + (h10 - h00) * t.x + (h11 - h10) * t.y;
}

/** Bodenfarbe (linear) und Grasanteil der Geländezelle. */
vec4 groundAt(vec2 xz) {
  float cell = terrainSize / (terrainRes - 1.0);
  ivec2 ij = ivec2(clamp(floor((xz + terrainSize * 0.5) / cell), vec2(0.0), vec2(terrainRes - 2.0)));
  return texelFetch(tGround, ij, 0);
}

/** 1 auf Straßen, Gehsteigen und Plätzen, sonst 0. */
float roadAt(vec2 xz) {
  return texture2D(tRoadMask, (xz + terrainSize * 0.5) / terrainSize).r;
}
`;

export interface TerrainUniforms {
  tHeight: { value: THREE.DataTexture };
  tGround: { value: THREE.DataTexture };
  tRoadMask: { value: THREE.Texture };
  terrainSize: { value: number };
  terrainRes: { value: number };
}

/**
 * Zusätzliche Linien in die Straßenmaske zeichnen (z. B. Wege zu den Haustüren),
 * damit dort kein Gras wächst.
 */
export function addMaskLines(u: TerrainUniforms, lines: { x: number; z: number }[][], width: number): void {
  const canvas = u.tRoadMask.value.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const size = u.terrainSize.value;
  const px = canvas.width;
  const toPx = (v: number) => ((v + size / 2) / size) * px;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, (width / size) * px);
  ctx.lineCap = 'round';
  for (const line of lines) {
    ctx.beginPath();
    line.forEach((p, i) => (i === 0 ? ctx.moveTo(toPx(p.x), toPx(p.z)) : ctx.lineTo(toPx(p.x), toPx(p.z))));
    ctx.stroke();
  }
  u.tRoadMask.value.needsUpdate = true;
}

/** Flächen (z. B. Hausgrundrisse) in die Straßenmaske füllen: dort wächst kein Gras. */
export function addMaskPolygons(u: TerrainUniforms, polygons: { x: number; z: number }[][]): void {
  const canvas = u.tRoadMask.value.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const size = u.terrainSize.value;
  const px = canvas.width;
  const toPx = (v: number) => ((v + size / 2) / size) * px;
  ctx.fillStyle = '#fff';
  for (const poly of polygons) {
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(toPx(p.x), toPx(p.z)) : ctx.lineTo(toPx(p.x), toPx(p.z))));
    ctx.closePath();
    ctx.fill();
  }
  u.tRoadMask.value.needsUpdate = true;
}

/** Breite der Straßenmaske je Belag in m (Fahrbahn plus Rand, Gehsteige in der Stadt). */
const MASK_WIDTH = { asphalt: 7, town: 11.5, gravel: 5.5, bridge: 0 } as const;
/** Gepflasterte Plätze: Knoten und Radius in m. */
export const PLAZAS: { node: string; radius: number }[] = [
  { node: 'markt', radius: 24 },
  { node: 'hafen', radius: 30 },
];

/** Texturen und Uniforms, die Gras und Wasser gemeinsam nutzen. */
export function createTerrainUniforms(terrain: Heightfield, roads: RoadNetwork, ground: GroundData): TerrainUniforms {
  const height = new THREE.DataTexture(terrain.data, terrain.res, terrain.res, THREE.RedFormat, THREE.FloatType);
  height.needsUpdate = true;

  const groundTex = new THREE.DataTexture(ground.rgba, ground.cells, ground.cells, THREE.RGBAFormat);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.needsUpdate = true;

  // Straßenmaske: Wege als Linien in eine Leinwand zeichnen (2 m pro Pixel)
  const px = Math.round(terrain.size / 2);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, px, px);
  const toPx = (v: number) => ((v + terrain.half) / terrain.size) * px;
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const e of roads.edges.values()) {
    if (e.surface === 'bridge') continue;
    ctx.lineWidth = (MASK_WIDTH[e.surface] / terrain.size) * px;
    ctx.beginPath();
    for (let i = 0; i < e.count; i++) {
      const x = toPx(e.xs[i]!);
      const y = toPx(e.zs[i]!);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (const p of PLAZAS) {
    const n = roads.nodes.get(p.node);
    if (!n) continue;
    ctx.beginPath();
    ctx.arc(toPx(n.x), toPx(n.z), ((p.radius + 1) / terrain.size) * px, 0, Math.PI * 2);
    ctx.fill();
  }
  const mask = new THREE.CanvasTexture(canvas);
  mask.colorSpace = THREE.NoColorSpace;
  mask.flipY = false; // Zeile 0 = Norden (z = −half), wie bei den DataTextures
  mask.minFilter = THREE.LinearFilter;
  mask.generateMipmaps = false;

  return {
    tHeight: { value: height },
    tGround: { value: groundTex },
    tRoadMask: { value: mask },
    terrainSize: { value: terrain.size },
    terrainRes: { value: terrain.res },
  };
}
