import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SKY = {
  top: new THREE.Color('#3f86d4'),
  horizon: new THREE.Color('#d4e7f3'),
  sun: new THREE.Color('#fff1d6'),
};

/** Richtung zur Sonne (normiert). Licht, Schatten, Himmel und Wasserglanz nutzen dieselbe. */
export const SUN_DIR = new THREE.Vector3(-0.5, 0.72, 0.42).normalize();
/** Zusätzliche Himmels-Uniforms (Tag-Nacht-Wechsel). */
export const SKY_EXTRA = {
  stars: { value: 0 },
  /** Stärke des Lichthofs um Sonne bzw. Mond. */
  halo: { value: 1 },
  /** Tageslicht 0 … 1 für Shader mit eigener Beleuchtung (Wasser). */
  daylight: { value: 1 },
};

/** Abstand der Schattenlichtquelle vom Fahrer in m. */
const SUN_DISTANCE = 600;

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  clouds: THREE.Group;
  sky: THREE.Mesh;
  /** Wird bei Größenänderung aufgerufen (für Nachbearbeitung). */
  onResize: ((w: number, h: number) => void) | null;
}

/**
 * Himmelskuppel mit Farbverlauf, Sonnenscheibe und Lichthof.
 * Ohne Tone Mapping, damit der Horizont genau zur Nebelfarbe passt.
 */
function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(5000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: SKY.top },
      horizon: { value: SKY.horizon },
      sunColor: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
      stars: SKY_EXTRA.stars,
      halo: SKY_EXTRA.halo,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform float stars;
      uniform float halo;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float t = max(0.0, dir.y);
        vec3 col = mix(horizon, top, pow(t, 0.55));
        // Sterne: zufällige Punkte in Zellen auf der Kugel, zum Horizont hin schwächer
        if (stars > 0.0) {
          vec3 q = dir * 260.0;
          vec3 cell = floor(q);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float star = step(0.986, h) * smoothstep(0.32, 0.05, length(fract(q) - 0.5));
          col += vec3(0.9, 0.93, 1.0) * star * stars * (0.45 + 0.55 * fract(h * 97.0)) * smoothstep(0.02, 0.25, dir.y);
        }
        float d = max(0.0, dot(dir, sunDir));
        // Lichthof und Scheibe (Sonne, nachts Mond)
        col += sunColor * (pow(d, 12.0) * 0.18 * halo + pow(d, 180.0) * 0.5 * halo);
        col = mix(col, sunColor * 1.6, smoothstep(0.99935, 0.9996, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/**
 * Bedeckung des Himmels 0 … 1 (Wetter). Jede Wolke hat einen Rang; sichtbar sind die
 * Wolken mit Rang unter der Bedeckung, sie wachsen dabei weich auf und werden größer.
 */
export const CLOUD_COVER = { value: 0.32 };

/** Low-Poly-Wolken aus abgeflachten Ikosaedern, langsam ziehend. */
function createClouds(count: number, seed = 7): THREE.Group {
  const group = new THREE.Group();
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const mat = new THREE.MeshLambertMaterial({
    color: '#ffffff', emissive: '#c9d6e2', emissiveIntensity: 0.55, flatShading: true, fog: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCover = CLOUD_COVER;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCloud;\nuniform float uCover;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Wolke wächst aus ihrer Mitte, sobald die Bedeckung ihren Rang erreicht; bei dichter Decke größer
        float grow = smoothstep(aCloud.w - 0.06, aCloud.w + 0.04, uCover) * (0.85 + 0.75 * uCover * uCover);
        transformed = aCloud.xyz + (transformed - aCloud.xyz) * grow;`,
      );
  };
  // Alle Wolken in einem Mesh: ein Zeichenaufruf statt über hundert
  const puff = new THREE.IcosahedronGeometry(1, 1);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const local = new THREE.Object3D();
  const cloud = new THREE.Object3D();
  for (let c = 0; c < count; c++) {
    const n = 3 + Math.floor(rnd() * 4);
    const size = 40 + rnd() * 60;
    const puffs: THREE.Matrix4[] = [];
    for (let p = 0; p < n; p++) {
      const r = size * (0.45 + rnd() * 0.45);
      local.scale.set(r * (1.1 + rnd() * 0.5), r * (0.45 + rnd() * 0.2), r);
      local.position.set((p - n / 2) * size * 0.55 + rnd() * 10, rnd() * size * 0.15, (rnd() - 0.5) * size * 0.6);
      local.rotation.set(0, rnd() * Math.PI, 0);
      local.updateMatrix();
      puffs.push(local.matrix.clone());
    }
    const ang = rnd() * Math.PI * 2;
    const dist = 400 + Math.sqrt(rnd()) * 2900;
    cloud.position.set(Math.cos(ang) * dist, 380 + rnd() * 320, Math.sin(ang) * dist);
    cloud.rotation.set(0, rnd() * Math.PI, 0);
    cloud.updateMatrix();
    // Rang gleichmäßig verteilt: bei Bedeckung x sind etwa x · count Wolken zu sehen
    const rank = (c + 0.5) / count;
    for (const pm of puffs) {
      const g = puff.clone().applyMatrix4(m.multiplyMatrices(cloud.matrix, pm));
      const n2 = g.attributes.position!.count;
      const a = new Float32Array(n2 * 4);
      for (let k = 0; k < n2; k++) a.set([cloud.position.x, cloud.position.y, cloud.position.z, rank], k * 4);
      g.setAttribute('aCloud', new THREE.BufferAttribute(a, 4));
      parts.push(g);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}

/** Szene, Kamera, Licht. Auflösung und Schattenqualität setzt `GraphicsController`. */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = SKY.horizon.clone();
  scene.fog = new THREE.Fog(SKY.horizon, 450, 2800);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);

  const sky = createSky();
  scene.add(sky);
  // Kuppel wandert mit der Kamera mit
  sky.onBeforeRender = () => sky.position.copy(camera.position);

  const clouds = createClouds(90);
  clouds.name = 'wolken';
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight('#d8ecff', '#6b7f45', 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SKY.sun, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DISTANCE);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 1500;
  // Gegen Streifen auf schrägen Flächen (Schattenakne): entlang der Normalen versetzen
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.06;
  // Größerer Radius wird mit der Vogel-Abtastung körnig, darum nur leicht weich
  sun.shadow.radius = 1.4;
  scene.add(sun, sun.target);

  const bundle: SceneBundle = { renderer, scene, camera, sun, hemi, clouds, sky, onResize: null };
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bundle.onResize?.(w, h);
  };
  resize();
  window.addEventListener('resize', resize);
  return bundle;
}

/** Schattenbereich folgt dem Fahrer, damit eine kleine Shadow-Map reicht. */
export function followSun(sun: THREE.DirectionalLight, target: THREE.Vector3): void {
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(SUN_DIR, SUN_DISTANCE);
}

/** Wolken ziehen langsam um die Insel. */
export function driftClouds(clouds: THREE.Group, dt: number, wind = 0): void {
  clouds.rotation.y += dt * 0.004 * (1 + 2 * wind);
}
