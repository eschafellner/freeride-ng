import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cellKey, DynamicLod, groupByCell, LodInstances, lodState } from '../src/game/lod';

const at = (x: number, z: number) => ({ matrix: new THREE.Matrix4().makeTranslation(x, 0, z) });
const geo = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshBasicMaterial();

describe('lodState', () => {
  it('nah, fern, ausgeblendet nach Entfernung', () => {
    expect(lodState(50, 100, 500, true)).toBe('near');
    expect(lodState(200, 100, 500, true)).toBe('far');
    expect(lodState(600, 100, 500, true)).toBe('hidden');
  });

  it('ohne Fernmodell bleibt das Detailmodell bis zum Ausblenden', () => {
    expect(lodState(200, 100, 500, false)).toBe('near');
  });

  it('Detailweite verschiebt die Grenzen, Ausblenden nie näher als eingestellt', () => {
    expect(lodState(140, 100, 500, true, 1.5)).toBe('near');
    expect(lodState(70, 100, 500, true, 0.6)).toBe('far');
    expect(lodState(450, 100, 500, true, 0.6)).toBe('far');
  });
});

describe('Kacheln', () => {
  it('ordnet nach Position zu, auch bei negativen Koordinaten', () => {
    expect(cellKey(10, 10, 100)).toBe('0,0');
    expect(cellKey(-10, 10, 100)).toBe('-1,0');
    const cells = groupByCell([at(10, 10), at(90, 20), at(-10, 5), at(250, 250)], 100);
    expect(cells.get('0,0')?.length).toBe(2);
    expect(cells.size).toBe(3);
  });

  it('LodInstances schaltet ganze Kacheln um', () => {
    const set = new LodInstances({ name: 't', near: geo, far: geo, material: mat, nearDist: 100, hideDist: 1000, cell: 100 }, [at(10, 10), at(510, 10)]);
    set.update(new THREE.Vector3(0, 0, 0), 1);
    const meshes = set.group.children as THREE.InstancedMesh[];
    const vis = (name: string) => meshes.find((m) => m.name === name)!.visible;
    expect(vis('t@0,0') && !vis('t~0,0')).toBe(true);
    expect(!vis('t@5,0') && vis('t~5,0')).toBe(true);
    expect(set.count).toBe(2);
  });
});

describe('DynamicLod', () => {
  it('verteilt Instanzen auf Nah- und Fernmesh', () => {
    const set = new DynamicLod({ name: 'd', near: geo, far: geo, material: mat, nearDist: 100, hideDist: 1000 },
      [at(10, 0), at(50, 0), at(300, 0), at(5000, 0)]);
    set.update(new THREE.Vector3(0, 0, 0), 1);
    const [near, far] = set.group.children as THREE.InstancedMesh[];
    expect(near!.count).toBe(2);
    expect(far!.count).toBe(1);
    // Nach Bewegung wandert die ferne Instanz ins Nahmesh
    set.update(new THREE.Vector3(300, 0, 0), 1);
    expect(near!.count).toBe(1);
    expect(far!.count).toBe(2);
  });
});
