import * as THREE from 'three';

export const SKY = {
  top: new THREE.Color('#4f93d8'),
  horizon: new THREE.Color('#cfe6f5'),
};

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize: () => void;
}

/** Himmelskuppel mit Farbverlauf (Vertexfarben, ohne Nebel). */
function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(5000, 24, 12);
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 5000);
    c.copy(SKY.horizon).lerp(SKY.top, Math.pow(t, 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  return sky;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = SKY.horizon.clone();
  scene.fog = new THREE.Fog(SKY.horizon, 400, 2600);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);

  const sky = createSky();
  scene.add(sky);
  // Kuppel wandert mit der Kamera mit
  sky.onBeforeRender = () => sky.position.copy(camera.position);

  scene.add(new THREE.HemisphereLight('#dff1ff', '#5d7a3a', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
  sun.position.set(-300, 500, 250);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 1500;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, resize };
}

/** Schattenbereich folgt dem Fahrer, damit eine kleine Shadow-Map reicht. */
export function followSun(sun: THREE.DirectionalLight, target: THREE.Vector3): void {
  sun.target.position.copy(target);
  sun.position.set(target.x - 300, target.y + 500, target.z + 250);
}
