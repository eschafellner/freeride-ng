import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import type { Poi } from '../world/pois';

/** Seitlicher Abstand von Schildern und Aussichtsplattformen zur Wegmitte. */
const SIGN_OFFSET = 5;
const VIEWPOINT_OFFSET = 12;

function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5d13b';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 12;
  ctx.strokeRect(14, 14, 484, 164);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 100, 460);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSign(p: Poi, textures: Map<string, THREE.CanvasTexture>): THREE.Group {
  const g = new THREE.Group();
  const name = p.name ?? '';
  let tex = textures.get(name);
  if (!tex) {
    tex = signTexture(name);
    textures.set(name, tex);
  }
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6),
    new THREE.MeshLambertMaterial({ color: '#888' }),
  );
  post.position.y = 1.2;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.82),
    new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.y = 2.2;
  g.add(post, board);
  // Rechts neben dem Weg, Schild quer zur Fahrbahn
  g.position.set(p.x - p.dirZ * SIGN_OFFSET, p.y, p.z + p.dirX * SIGN_OFFSET);
  g.rotation.y = Math.atan2(p.dirX, p.dirZ);
  return g;
}

function makeViewpoint(p: Poi, terrain: Heightfield): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: '#8a5a33', flatShading: true });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#3d6e3a', flatShading: true });
  // Kleiner Holzturm mit Dach und Fahne
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), wood);
    leg.position.set(x, 3, z);
    g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 3.2), wood);
  deck.position.y = 4.2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 4), roofMat);
  roof.position.y = 6.8;
  roof.rotation.y = Math.PI / 4;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 5), wood);
  pole.position.y = 8.2;
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.6),
    new THREE.MeshLambertMaterial({ color: '#e4572e', side: THREE.DoubleSide }),
  );
  flag.position.set(0.55, 8.8, 0);
  flag.name = 'flag';
  // Bank davor
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), wood);
  bench.position.set(0, 0.5, 2.6);
  g.add(deck, roof, pole, flag, bench);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const x = p.x - p.dirZ * VIEWPOINT_OFFSET;
  const z = p.z + p.dirX * VIEWPOINT_OFFSET;
  g.position.set(x, Math.max(p.y, terrain.sample(x, z)) - 0.1, z);
  return g;
}

/** Schwebender Kristall, eigenes Low-Poly-Design. */
function makeCollectible(p: Poi, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p.x, p.y + 1.4, p.z);
  m.userData.baseY = p.y + 1.4;
  m.castShadow = true;
  return m;
}

export class PoiMeshes {
  readonly group = new THREE.Group();
  private readonly collectibles = new Map<string, THREE.Mesh>();
  private readonly flags: THREE.Object3D[] = [];
  private time = 0;

  constructor(pois: Poi[], terrain: Heightfield, collected: Set<string>) {
    const textures = new Map<string, THREE.CanvasTexture>();
    const gemGeo = new THREE.OctahedronGeometry(0.55, 0).scale(1, 1.5, 1);
    const gemMat = new THREE.MeshLambertMaterial({
      color: '#ffd23f',
      emissive: '#ff9f1c',
      emissiveIntensity: 0.6,
      flatShading: true,
    });
    for (const p of pois) {
      if (p.type === 'sign') this.group.add(makeSign(p, textures));
      else if (p.type === 'viewpoint') {
        const v = makeViewpoint(p, terrain);
        const flag = v.getObjectByName('flag');
        if (flag) this.flags.push(flag);
        this.group.add(v);
      } else if (!collected.has(p.id)) {
        const m = makeCollectible(p, gemGeo, gemMat);
        this.collectibles.set(p.id, m);
        this.group.add(m);
      }
    }
  }

  /** Entfernt ein eingesammeltes Objekt aus der Szene. */
  collect(id: string): void {
    const m = this.collectibles.get(id);
    if (!m) return;
    this.group.remove(m);
    this.collectibles.delete(id);
  }

  animate(dt: number): void {
    this.time += dt;
    for (const m of this.collectibles.values()) {
      m.rotation.y += dt * 1.6;
      m.position.y = (m.userData.baseY as number) + Math.sin(this.time * 2 + m.position.x) * 0.25;
    }
    for (const f of this.flags) f.rotation.y = Math.sin(this.time * 1.7) * 0.35;
  }
}
