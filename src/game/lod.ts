import * as THREE from 'three';

/**
 * Kacheln und Detailstufen für viele gleiche Objekte (Häuser, Bäume, Reben …).
 *
 * Ein InstancedMesh über die ganze Insel kann weder vom Blickfeld noch vom
 * Schattenwurf weggeschnitten werden. Darum werden die Objekte in Kacheln
 * aufgeteilt: jede Kachel ist ein eigenes InstancedMesh mit eigener Hüllkugel.
 * Nahe Kacheln zeigen das Detailmodell, ferne ein einfaches Modell, sehr ferne nichts.
 */

export interface LodItem {
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export interface LodOptions {
  name: string;
  near: THREE.BufferGeometry;
  /** Einfaches Modell für die Ferne; ohne: das Detailmodell bis `hide`. */
  far?: THREE.BufferGeometry | null;
  material: THREE.Material;
  /** Bis zu dieser Entfernung (m) das Detailmodell. */
  nearDist: number;
  /** Ab dieser Entfernung (m) nichts mehr zeigen. */
  hideDist: number;
  /** Kantenlänge der Kacheln in m. */
  cell?: number;
  castShadow?: boolean;
  /** Fernmodell wirft Schatten (Standard: wie castShadow). */
  farShadow?: boolean;
  receiveShadow?: boolean;
}

export type LodState = 'near' | 'far' | 'hidden';

/**
 * Welche Stufe gilt bei dieser Entfernung? Die Entfernung zählt bis zum
 * nächsten Rand der Kachel (Mitte minus Radius), damit nichts aufploppt.
 * @param scale Faktor aus den Grafik-Einstellungen (größer = weiter Details)
 */
export function lodState(distance: number, nearDist: number, hideDist: number, hasFar: boolean, scale = 1): LodState {
  if (distance >= hideDist * Math.max(1, scale)) return 'hidden';
  if (distance < nearDist * scale) return 'near';
  return hasFar ? 'far' : 'near';
}

/** Schlüssel der Kachel für eine Position. */
export function cellKey(x: number, z: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
}

/** Ordnet Objekte ihren Kacheln zu (nach der Position in der Matrix). */
export function groupByCell<T extends LodItem>(items: T[], cell: number): Map<string, T[]> {
  const cells = new Map<string, T[]>();
  const p = new THREE.Vector3();
  for (const it of items) {
    p.setFromMatrixPosition(it.matrix);
    const key = cellKey(p.x, p.z, cell);
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(it);
  }
  return cells;
}

interface Chunk {
  center: THREE.Vector3;
  radius: number;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh | null;
  state: LodState | null;
}

function instancedFrom(geo: THREE.BufferGeometry, mat: THREE.Material, items: LodItem[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.computeBoundingSphere();
  mesh.name = name;
  return mesh;
}

export class LodInstances {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];

  constructor(private readonly opts: LodOptions, items: LodItem[]) {
    this.group.name = opts.name;
    const cell = opts.cell ?? 150;
    for (const [key, list] of groupByCell(items, cell)) {
      const near = instancedFrom(opts.near, opts.material, list, `${opts.name}@${key}`);
      near.castShadow = opts.castShadow ?? false;
      near.receiveShadow = opts.receiveShadow ?? true;
      let far: THREE.InstancedMesh | null = null;
      if (opts.far) {
        far = instancedFrom(opts.far, opts.material, list, `${opts.name}~${key}`);
        far.castShadow = opts.farShadow ?? opts.castShadow ?? false;
        far.receiveShadow = opts.receiveShadow ?? true;
        far.visible = false;
        this.group.add(far);
      }
      this.group.add(near);
      const sphere = near.boundingSphere!;
      this.chunks.push({ center: sphere.center.clone(), radius: sphere.radius, near, far, state: null });
    }
  }

  get count(): number {
    return this.chunks.reduce((s, c) => s + c.near.count, 0);
  }

  update(camera: THREE.Vector3, scale: number): void {
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.center.x - camera.x, c.center.z - camera.z) - c.radius);
      const state = lodState(d, this.opts.nearDist, this.opts.hideDist, c.far !== null, scale);
      if (state === c.state) continue;
      c.state = state;
      c.near.visible = state === 'near';
      if (c.far) c.far.visible = state === 'far';
    }
  }
}

/**
 * Detailstufe pro Objekt statt pro Kachel: genau ein Nah- und ein Fernmesh, deren
 * Instanzen bei Bewegung neu verteilt werden. Für Modelle mit vielen Varianten
 * (Häuser), damit die Zahl der Zeichenaufrufe klein bleibt. Das Nahmesh hat eine
 * kleine Hüllkugel und wird darum auch beim Schattenwurf weggeschnitten.
 */
export class DynamicLod {
  readonly group = new THREE.Group();
  private readonly near: THREE.InstancedMesh;
  private readonly far: THREE.InstancedMesh | null;
  private readonly pos: THREE.Vector3[];

  constructor(private readonly opts: LodOptions, private readonly items: LodItem[]) {
    this.group.name = opts.name;
    this.pos = items.map((it) => new THREE.Vector3().setFromMatrixPosition(it.matrix));
    const make = (geo: THREE.BufferGeometry, suffix: string, shadow: boolean) => {
      const m = new THREE.InstancedMesh(geo, opts.material, Math.max(1, items.length));
      if (items.some((it) => it.color)) m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.count = 0;
      m.name = `${opts.name}${suffix}`;
      m.castShadow = shadow;
      m.receiveShadow = opts.receiveShadow ?? true;
      this.group.add(m);
      return m;
    };
    this.near = make(opts.near, '@nah', opts.castShadow ?? false);
    this.far = opts.far ? make(opts.far, '~fern', opts.farShadow ?? opts.castShadow ?? false) : null;
  }

  update(camera: THREE.Vector3, scale: number): void {
    let n = 0;
    let f = 0;
    const white = new THREE.Color(1, 1, 1);
    this.items.forEach((it, i) => {
      const p = this.pos[i]!;
      const state = lodState(Math.hypot(p.x - camera.x, p.z - camera.z), this.opts.nearDist, this.opts.hideDist, this.far !== null, scale);
      const mesh = state === 'near' ? this.near : state === 'far' ? this.far : null;
      if (!mesh) return;
      const k = mesh === this.near ? n++ : f++;
      mesh.setMatrixAt(k, it.matrix);
      if (mesh.instanceColor) mesh.setColorAt(k, it.color ?? white);
    });
    for (const [mesh, count] of [[this.near, n], [this.far, f]] as const) {
      if (!mesh) continue;
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (count > 0) mesh.computeBoundingSphere();
    }
  }
}

interface LodSet {
  readonly group: THREE.Group;
  update(camera: THREE.Vector3, scale: number): void;
}

/**
 * Alle Kachelgruppen der Szene. `update` läuft ein paarmal pro Sekunde,
 * `scale` kommt aus den Grafik-Einstellungen (Detailweite).
 */
export class LodRegistry {
  private readonly sets: LodSet[] = [];
  private readonly last = new THREE.Vector3(Infinity, 0, Infinity);
  scale = 1;
  private dirty = true;

  add<T extends LodSet>(set: T): T {
    this.sets.push(set);
    this.dirty = true;
    return set;
  }

  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.dirty = true;
  }

  /** Nur neu rechnen, wenn sich die Kamera merklich bewegt hat. */
  update(camera: THREE.Vector3): void {
    if (!this.dirty && Math.hypot(camera.x - this.last.x, camera.z - this.last.z) < 4) return;
    this.dirty = false;
    this.last.copy(camera);
    for (const s of this.sets) s.update(camera, this.scale);
  }
}

/** Gemeinsame Registry für die Spielszene. */
export const lod = new LodRegistry();
