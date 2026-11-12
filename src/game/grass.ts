import * as THREE from 'three';
import { NOISE_GLSL, TERRAIN_GLSL, type TerrainUniforms } from './shaderChunks';

/**
 * Gras und Blumen um die Kamera.
 *
 * Die Büschel liegen in einer Kachel fester Größe, die im Vertex-Shader um die
 * Kamera herum „umgeklappt“ wird: Jedes Büschel hat eine feste Weltposition
 * (Kachelmuster), sichtbar ist immer nur das Quadrat um die Kamera. Höhe,
 * Bodenart und Straßen kommen aus Texturen, die CPU tut pro Frame nichts.
 *
 * Zwei Stufen gegen sichtbares Nachladen: eine dichte Kachel in der Nähe und eine
 * lockere, größere bis zur Sichtweite. Die Übergänge dünnen das Gras zufällig aus
 * und lassen es schrumpfen, zum Rand hin nimmt es die Farbe des Bodens an.
 */

/** Radius der dichten Stufe in m (höchstens; bei kleiner Sichtweite entsprechend weniger). */
const NEAR_RADIUS = 32;

const BLADES = 3;

/**
 * Ein Büschel: drei gekreuzte Halme (je ein Dreieck), Höhe 1.
 * Dazu eine kleine Blüte (zwei waagrechte Dreiecke), die nur bei Blumen sichtbar wird.
 */
function tuftGeometry(): { position: number[]; tip: number[]; cap: number[] } {
  const position: number[] = [];
  const tip: number[] = [];
  const cap: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI + 0.3;
    const ca = Math.cos(a) * 0.16;
    const sa = Math.sin(a) * 0.16;
    const lean = (b - 1) * 0.35;
    position.push(-ca, 0, -sa, ca, 0, sa, lean * sa, 1, -lean * ca);
    tip.push(0, 0, 1);
    cap.push(0, 0, 0);
  }
  const r = 0.16;
  position.push(-r, 1, 0, 0, 1, r, r, 1, 0, -r, 1, 0, r, 1, 0, 0, 1, -r);
  for (let i = 0; i < 6; i++) {
    tip.push(1);
    cap.push(1);
  }
  return { position, tip, cap };
}

export interface Grass {
  group: THREE.Group;
  update(time: number, camera: THREE.Camera): void;
  dispose(): void;
}

interface LayerOptions {
  /** Halbe Kachelgröße in m. */
  radius: number;
  density: number;
  /** Einblenden zwischen fadeIn[0] und fadeIn[1] m Abstand (für die äußere Stufe). */
  fadeIn: [number, number];
  /** Ausblenden zwischen fadeOut[0] und fadeOut[1] m. */
  fadeOut: [number, number];
  /** Größe der Büschel (die ferne Stufe etwas größer, damit sie bei geringerer Dichte trägt). */
  scale: number;
  /** Ab hier bis zur Sichtweite gleicht sich die Farbe dem Boden an. */
  colorFade: [number, number];
  seed: number;
}

/**
 * @param distance Sichtweite in m (0 = kein Gras)
 * @param density Büschel pro m² in der Nähe
 */
export function createGrass(distance: number, density: number, terrain: TerrainUniforms): Grass | null {
  if (distance <= 0) return null;
  const group = new THREE.Group();
  const time = { value: 0 };
  const cam = { value: new THREE.Vector2() };
  const nearR = Math.min(NEAR_RADIUS, distance);
  const colorFade: [number, number] = [distance * 0.45, distance];
  const layers: LayerOptions[] = [];
  if (distance <= NEAR_RADIUS * 1.2) {
    layers.push({ radius: distance, density, fadeIn: [-1, 0], fadeOut: [distance * 0.55, distance], scale: 1, colorFade, seed: 12345 });
  } else {
    layers.push({ radius: nearR, density, fadeIn: [-1, 0], fadeOut: [nearR * 0.6, nearR], scale: 1, colorFade, seed: 12345 });
    layers.push({
      radius: distance, density: density / 3.5, fadeIn: [nearR * 0.55, nearR],
      fadeOut: [Math.max(nearR, distance * 0.5), distance], scale: 1.3, colorFade, seed: 777,
    });
  }
  const meshes = layers.map((l) => createLayer(l, terrain, time, cam));
  group.add(...meshes);
  return {
    group,
    update(t, camera) {
      time.value = t;
      cam.value.set(camera.position.x, camera.position.z);
    },
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}

function createLayer(
  o: LayerOptions, terrain: TerrainUniforms, time: { value: number }, cam: { value: THREE.Vector2 },
): THREE.Mesh {
  const tile = o.radius * 2;
  const count = Math.round(tile * tile * o.density);

  const base = tuftGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(base.position, 3));
  geo.setAttribute('tip', new THREE.Float32BufferAttribute(base.tip, 1));
  geo.setAttribute('cap', new THREE.Float32BufferAttribute(base.cap, 1));
  // Platzhalter, damit der Lambert-Shader vColor anlegt (wird im Shader gesetzt)
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(base.tip.length * 3).fill(1), 3));

  // Pro Büschel: Lage in der Kachel (x, z), Zufallswert
  const offsets = new Float32Array(count * 3);
  let s = o.seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = rnd() * tile;
    offsets[i * 3 + 1] = rnd() * tile;
    offsets[i * 3 + 2] = rnd();
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.instanceCount = count;

  const uniforms = {
    ...terrain,
    uTime: time,
    uCam: cam,
    uTile: { value: tile },
    uFadeIn: { value: new THREE.Vector2(...o.fadeIn) },
    uFadeOut: { value: new THREE.Vector2(...o.fadeOut) },
    uColorFade: { value: new THREE.Vector2(...o.colorFade) },
    uScale: { value: o.scale },
  };

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float tip;
        attribute float cap;
        attribute vec3 offset;
        uniform float uTime;
        uniform vec2 uCam;
        uniform float uTile;
        uniform vec2 uFadeIn;
        uniform vec2 uFadeOut;
        uniform vec2 uColorFade;
        uniform float uScale;
        ${NOISE_GLSL}
        ${TERRAIN_GLSL}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        // Normalen nach oben: Gras wird wie der Boden beleuchtet, ohne harte Seiten
        'vec3 objectNormal = vec3(0.0, 1.0, 0.0);',
      )
      .replace(
        '#include <begin_vertex>',
        `
        // Lage in der Welt: Kachel um die Kamera umklappen
        vec2 origin = uCam - uTile * 0.5;
        vec2 wp = origin + mod(offset.xy - origin, uTile);
        float dist = length(wp - uCam);
        // Übergänge: zufällig ausdünnen und schrumpfen statt harter Kante
        float fade = smoothstep(uFadeIn.x, uFadeIn.y, dist) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, dist));
        float thin = step(fract(offset.z * 17.3), fade);
        vec4 ground = groundAt(wp);
        float road = roadAt(wp);
        float h = terrainHeight(wp);
        // Dichte: Grasanteil des Bodens, Flecken, keine Halme auf Wegen und im Wasser
        float patchy = vnoise(wp / 9.0);
        float keep = step(offset.z, ground.a * (0.55 + patchy * 0.7)) * (1.0 - step(0.35, road)) * step(1.5, h);
        float size = keep * thin * (0.35 + 0.65 * fade) * uScale * (0.22 + 0.2 * fract(offset.z * 7.31) + patchy * 0.18);
        // Blumen: wenige Büschel mit Blüte, auf Wiesen
        float flower = step(fract(offset.z * 91.7), 0.06) * step(0.5, ground.a);
        // Wind
        float gust = vnoise(wp / 14.0 + uTime * 0.35);
        vec2 sway = vec2(sin(uTime * 1.7 + wp.x * 0.21), cos(uTime * 1.3 + wp.y * 0.17)) * (0.06 + gust * 0.12);
        float rot = fract(offset.z * 13.7) * 6.2831;
        mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
        vec2 rxz = R * position.xz;
        vec3 transformed = vec3(rxz.x, position.y, rxz.y);
        transformed *= size * (1.0 + flower * 0.4);
        transformed *= 1.0 - cap * (1.0 - flower);
        transformed.xz += sway * tip * size;
        transformed += vec3(wp.x, h, wp.y);
        `,
      )
      .replace(
        // Farbe erst am Ende setzen: Bodenart und Blume stehen erst nach begin_vertex fest
        '#include <fog_vertex>',
        `#include <fog_vertex>
        {
          // Pro Büschel etwas Helligkeit und Ton variieren
          float v = fract(offset.z * 23.9);
          vec3 base = ground.rgb * vec3(0.92 + v * 0.1, 1.0, 0.8 + v * 0.08) * (0.88 + v * 0.2);
          vec3 tipCol = base * vec3(1.18, 1.22, 0.95) + vec3(0.02, 0.03, 0.0);
          vColor.rgb = mix(base * 0.72, tipCol, tip);
          float kind = fract(offset.z * 53.1);
          vec3 bloom = kind < 0.35 ? vec3(0.95, 0.95, 0.9) : kind < 0.6 ? vec3(0.95, 0.78, 0.12)
            : kind < 0.8 ? vec3(0.55, 0.35, 0.85) : vec3(0.85, 0.15, 0.12);
          vColor.rgb = mix(vColor.rgb, bloom, cap);
          // In der Ferne in die Bodenfarbe übergehen, damit das Ende nicht auffällt
          vColor.rgb = mix(vColor.rgb, ground.rgb, smoothstep(uColorFade.x, uColorFade.y, dist) * 0.85);
        }`,
      );
    // Rückseiten nicht abdunkeln: Normale immer nach oben (in Kamerakoordinaten)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`,
    );
  };
  // Kein Modell-Matrix-Versatz: Positionen sind schon Weltkoordinaten
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
