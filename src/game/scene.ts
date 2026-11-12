import * as THREE from 'three';

export const SKY = {
  top: new THREE.Color('#3f86d4'),
  horizon: new THREE.Color('#d4e7f3'),
  sun: new THREE.Color('#fff1d6'),
};

/** Richtung zur Sonne (normiert). Licht, Schatten, Himmel und Wasserglanz nutzen dieselbe. */
export const SUN_DIR = new THREE.Vector3(-0.5, 0.72, 0.42).normalize();
/** Abstand der Schattenlichtquelle vom Fahrer in m. */
const SUN_DISTANCE = 600;

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
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
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float t = max(0.0, dir.y);
        vec3 col = mix(horizon, top, pow(t, 0.55));
        float d = max(0.0, dot(dir, sunDir));
        // Lichthof und Scheibe
        col += sunColor * (pow(d, 12.0) * 0.18 + pow(d, 180.0) * 0.5);
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
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (let c = 0; c < count; c++) {
    const cloud = new THREE.Group();
    const parts = 3 + Math.floor(rnd() * 4);
    const size = 40 + rnd() * 60;
    for (let p = 0; p < parts; p++) {
      const m = new THREE.Mesh(puff, mat);
      const r = size * (0.45 + rnd() * 0.45);
      m.scale.set(r * (1.1 + rnd() * 0.5), r * (0.45 + rnd() * 0.2), r);
      m.position.set((p - parts / 2) * size * 0.55 + rnd() * 10, rnd() * size * 0.15, (rnd() - 0.5) * size * 0.6);
      m.rotation.y = rnd() * Math.PI;
      cloud.add(m);
    }
    const ang = rnd() * Math.PI * 2;
    const dist = 500 + rnd() * 2600;
    cloud.position.set(Math.cos(ang) * dist, 380 + rnd() * 320, Math.sin(ang) * dist);
    cloud.rotation.y = rnd() * Math.PI;
    group.add(cloud);
  }
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

  const clouds = createClouds(26);
  scene.add(clouds);

  scene.add(new THREE.HemisphereLight('#d8ecff', '#6b7f45', 1.25));
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

  const bundle: SceneBundle = { renderer, scene, camera, sun, clouds, sky, onResize: null };
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
export function driftClouds(clouds: THREE.Group, dt: number): void {
  clouds.rotation.y += dt * 0.004;
}
