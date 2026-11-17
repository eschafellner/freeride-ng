import * as THREE from 'three';
import type { Heightfield } from '../world/heightfield';
import { fieldAt, REBLAND } from '../world/placement';
import { mulberry32, smoothstep } from '../world/random';
import type { RoadNetwork } from '../world/roadNetwork';
import { nearestLake } from '../world/lakes';
import { kogelMask, seenMask, steppeMask, townMask } from '../world/terrainGen';
import { NOISE_GLSL } from './shaderChunks';

const COLORS = {
  sand: new THREE.Color('#e3cf9a'),
  grassA: new THREE.Color('#7fb24a'),
  grassB: new THREE.Color('#6aa13f'),
  meadow: new THREE.Color('#9cc25a'),
  forest: new THREE.Color('#4f8a3a'),
  rock: new THREE.Color('#9a9184'),
  town: new THREE.Color('#c9c2b0'),
  verge: new THREE.Color('#7f9e4a'),
  seabed: new THREE.Color('#c8b98a'),
  vineyardSoil: new THREE.Color('#a08a5a'),
  // Glutsteppe
  ochre: new THREE.Color('#c9a26a'),
  dust: new THREE.Color('#b8865a'),
  dryGrass: new THREE.Color('#a8a05a'),
  redRock: new THREE.Color('#a8553a'),
  redRockDark: new THREE.Color('#8a4330'),
  dryVerge: new THREE.Color('#a8955e'),
  // Hoher Kogel: Almwiesen, Geröll und Fels oberhalb der Baumgrenze
  alpine: new THREE.Color('#9fb85a'),
  alpineDry: new THREE.Color('#b6b270'),
  scree: new THREE.Color('#a9a497'),
  screeDark: new THREE.Color('#87827a'),
  // Spiegelseen: Seegrund, Kiesufer, Uferwiesen
  lakeBed: new THREE.Color('#7d7a58'),
  lakeBedDeep: new THREE.Color('#4f5a48'),
  pebbles: new THREE.Color('#bdb08a'),
  shoreMeadow: new THREE.Color('#86b94e'),
};

/** Höhen am Kogel in m: ab hier Almwiesen statt Wald, darüber Geröll und Fels. */
export const TREELINE = 470;
export const SCREE_LINE = 590;

/** Zellen pro Kachelkante (≈ 600 m bei 10-m-Raster). */
const TILE_CELLS = 60;
/** Zellen, deren Ecken alle tiefer liegen, werden durch eine flache Platte ersetzt. */
const DEEP = -8.5;

/** Feldarten: reifes Getreide, junges Grün, Acker, Raps. */
const FIELD_COLORS = ['#d8c26a', '#a9cf5c', '#9a7a52', '#e6d84a'].map((c) => new THREE.Color(c));

/**
 * Bodenart je Geländezelle für Gras und Wasser im Shader:
 * RGB = Bodenfarbe, A = Grasanteil (0 = kahl, 255 = dichte Wiese).
 */
export interface GroundData {
  cells: number;
  rgba: Uint8Array;
}

/**
 * Low-Poly-Gelände: jedes Dreieck hat eine eigene, flache Farbe
 * (nicht indizierte Geometrie → flache Normalen).
 */
export function createTerrainMesh(
  terrain: Heightfield, roads: RoadNetwork, seed: number,
): { mesh: THREE.Group; tiles: THREE.Mesh[]; ground: GroundData } {
  const res = terrain.res;
  const cells = res - 1;
  const triCount = cells * cells * 2;
  const positions = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 9);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const tmp = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ground = new Uint8Array(cells * cells * 4);
  let grass = 0;

  let p = 0;
  const pushTri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number) => {
    a.set(terrain.worldX(i0), terrain.get(i0, j0), terrain.worldZ(j0));
    b.set(terrain.worldX(i1), terrain.get(i1, j1), terrain.worldZ(j1));
    c.set(terrain.worldX(i2), terrain.get(i2, j2), terrain.worldZ(j2));

    // Flächennormale für die Farbwahl (Fels an steilen Stellen)
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const h = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const mask = roads.maskAt(terrain, cx, cz);
    const r = rng();
    let lake: ReturnType<typeof nearestLake>;

    // Am Kogel sind die Flanken gleichmäßig steil und bewaldet: Fels erst bei steileren Stellen
    const steep = Math.abs(n.y) < (kogelMask(cx, cz) > 0.03 ? 0.68 : 0.82);
    grass = 1;
    if (h < -0.5) {
      tmp.copy(COLORS.seabed);
      grass = 0;
    } else if (h < 2.5) {
      tmp.copy(COLORS.sand);
      grass = 0;
    }
    // Spiegelseen: Seegrund, schmales Kiesufer, Uferwiesen statt Wald
    else if (seenMask(cx, cz) > 0.3 && (lake = nearestLake(cx, cz)).lake && lake.e < 1.6 && mask < 0.15) {
      const level = lake.lake!.level;
      if (h < level - 0.25) {
        tmp.copy(COLORS.lakeBed).lerp(COLORS.lakeBedDeep, smoothstep(0, 6, level - h) * 0.8 + r * 0.1);
        grass = 0;
      } else if (h < level + 0.9 + r * 0.5) {
        tmp.copy(COLORS.pebbles).lerp(COLORS.lakeBed, r * 0.35);
        grass = 0.1;
      } else {
        tmp.copy(COLORS.shoreMeadow).lerp(COLORS.forest, smoothstep(1.25, 1.6, lake.e) * 0.6 + r * 0.15);
        grass = 0.85;
      }
    }
    // Glutsteppe: trockener Boden, rote Felswände, wenig Gras
    else if (steppeMask(cx, cz) > 0.5) {
      if (mask > 0.15) {
        tmp.copy(COLORS.dryVerge).lerp(COLORS.dust, r * 0.4);
        grass = 0.15;
      } else if (Math.abs(n.y) < 0.9 && h < 9) {
        // Steilufer an der Bucht: sandig statt Fels
        tmp.copy(COLORS.sand).lerp(COLORS.dust, 0.3 + r * 0.3);
        grass = 0;
      } else if (Math.abs(n.y) < 0.9) {
        // Schichten im Fels: Farbe wechselt mit der Höhe
        tmp.copy(Math.floor(h / 6) % 2 ? COLORS.redRock : COLORS.redRockDark).lerp(COLORS.dust, r * 0.2);
        grass = 0;
      } else {
        const patch = Math.sin(cx / 37) * Math.cos(cz / 53) + r * 0.6;
        tmp.copy(patch > 0.5 ? COLORS.dryGrass : COLORS.ochre).lerp(COLORS.dust, r * 0.35);
        grass = patch > 0.5 ? 0.35 : 0.08;
      }
    }
    // Hoher Kogel oberhalb der Baumgrenze: Almwiesen, darüber Geröll und Fels
    else if (h > TREELINE - 25 + r * 30) {
      // Geröllfelder fleckig zwischen Rasenpolstern, nach oben hin mehr
      const blot = Math.sin(cx / 23 + Math.cos(cz / 31)) * Math.cos(cz / 19 - Math.sin(cx / 27));
      const rocky = smoothstep(SCREE_LINE - 40, SCREE_LINE + 60, h + (r - 0.5) * 50 + blot * 45) * (0.6 + 0.4 * blot);
      if (mask > 0.15 && rocky < 0.5) tmp.copy(COLORS.verge).lerp(COLORS.alpine, 0.5);
      else if (rocky > 0.5 || Math.abs(n.y) < 0.8) {
        tmp.copy(r < 0.5 ? COLORS.scree : COLORS.screeDark).lerp(COLORS.alpineDry, (1 - rocky) * 0.4);
        grass = 0.08 + (1 - rocky) * 0.2;
      } else {
        const patch = Math.sin(cx / 29) * Math.cos(cz / 41) + r * 0.7;
        tmp.copy(patch > 0.6 ? COLORS.alpineDry : COLORS.alpine).lerp(COLORS.meadow, r * 0.3);
        grass = 0.75;
      }
    }
    // Böschungen an Wegen: begrünt statt Fels
    else if (mask > 0.15) tmp.copy(COLORS.verge).lerp(COLORS.grassB, steep ? 0.2 : 0.5 + r * 0.3);
    else if (steep) {
      tmp.copy(COLORS.rock);
      grass = 0.1;
    } else if (townMask(cx, cz) > 0.6) {
      tmp.copy(COLORS.grassA).lerp(COLORS.town, 0.35 + r * 0.25);
      grass = 0.06; // Stadt: nur vereinzelte Büschel
    } else if (Math.hypot(cx - REBLAND.x, cz - REBLAND.z) < REBLAND.radius && h > 15) {
      // Rebland: Wiese mit offenen Bodenstellen zwischen den Weinbergen
      tmp.copy(COLORS.grassA).lerp(COLORS.vineyardSoil, 0.25 + r * 0.3);
      grass = 0.6;
    } else if (h < 90 && Math.abs(n.y) > 0.985 && mask < 0.05) {
      // Flachland: Flickenteppich aus Feldern
      const f = fieldAt(cx, cz, seed);
      if (f === null) tmp.copy(COLORS.grassA).lerp(COLORS.meadow, r * 0.4);
      else {
        tmp.copy(FIELD_COLORS[f]!).lerp(COLORS.grassB, r * 0.08);
        grass = f === 2 ? 0.15 : 0.9; // Acker fast kahl
      }
    }
    else if (h > 150) {
      tmp.copy(COLORS.forest).lerp(COLORS.rock, r * 0.3);
      grass = 0.7;
    } else tmp.copy(r < 0.5 ? COLORS.grassA : COLORS.grassB).lerp(COLORS.meadow, r * 0.4);

    for (const v of [a, b, c]) {
      positions[p] = v.x;
      positions[p + 1] = v.y;
      positions[p + 2] = v.z;
      colors[p] = tmp.r;
      colors[p + 1] = tmp.g;
      colors[p + 2] = tmp.b;
      p += 3;
    }
  };

  // Bodenart der Zelle: Mittel beider Dreiecke (Farbe im sRGB-Raum, wie Texturen)
  const cellColor = new THREE.Color();
  const writeCell = (i: number, j: number, c1: THREE.Color, g1: number, c2: THREE.Color, g2: number) => {
    cellColor.copy(c1).lerp(c2, 0.5);
    const k = (j * cells + i) * 4;
    const rgb = cellColor.clone().convertLinearToSRGB();
    ground[k] = Math.round(rgb.r * 255);
    ground[k + 1] = Math.round(rgb.g * 255);
    ground[k + 2] = Math.round(rgb.b * 255);
    ground[k + 3] = Math.round(((g1 + g2) / 2) * 255);
  };
  const first = new THREE.Color();

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      // Diagonale abwechselnd, wirkt weniger gleichförmig
      if ((i + j) % 2 === 0) {
        pushTri(i, j, i, j + 1, i + 1, j);
        first.copy(tmp);
        const g = grass;
        pushTri(i + 1, j, i, j + 1, i + 1, j + 1);
        writeCell(i, j, first, g, tmp, grass);
      } else {
        pushTri(i, j, i, j + 1, i + 1, j + 1);
        first.copy(tmp);
        const g = grass;
        pushTri(i, j, i + 1, j + 1, i + 1, j);
        writeCell(i, j, first, g, tmp, grass);
      }
    }
  }

  // In Kacheln aufteilen (Blickfeld-Culling); Zellen tief unter Wasser weglassen,
  // dort liegt eine flache Platte als Meeresgrund
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  addGroundDetail(mat);
  const group = new THREE.Group();
  const tiles: THREE.Mesh[] = [];
  const tileCells = Math.max(1, Math.ceil(cells / Math.max(1, Math.round(cells / TILE_CELLS))));
  const deep = (i: number, j: number) =>
    terrain.get(i, j) < DEEP && terrain.get(i + 1, j) < DEEP && terrain.get(i, j + 1) < DEEP && terrain.get(i + 1, j + 1) < DEEP;
  let skipped = 0;
  for (let tj = 0; tj < cells; tj += tileCells) {
    for (let ti = 0; ti < cells; ti += tileCells) {
      const keep: number[] = [];
      for (let j = tj; j < Math.min(cells, tj + tileCells); j++) {
        for (let i = ti; i < Math.min(cells, ti + tileCells); i++) {
          if (deep(i, j)) skipped++;
          else keep.push(j * cells + i);
        }
      }
      if (keep.length === 0) continue;
      // Je Zelle 2 Dreiecke à 3 Ecken à 3 Werte = 18 Floats, in Erzeugungsreihenfolge
      const pos = new Float32Array(keep.length * 18);
      const col = new Float32Array(keep.length * 18);
      keep.forEach((c, k) => {
        pos.set(positions.subarray(c * 18, c * 18 + 18), k * 18);
        col.set(colors.subarray(c * 18, c * 18 + 18), k * 18);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const tile = new THREE.Mesh(geo, mat);
      tile.name = `gelaende-${ti / tileCells}-${tj / tileCells}`;
      tile.receiveShadow = true;
      tiles.push(tile);
      group.add(tile);
    }
  }
  if (skipped > 0) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(terrain.size, terrain.size).rotateX(-Math.PI / 2).translate(0, DEEP - 1.2, 0),
      new THREE.MeshLambertMaterial({ color: COLORS.seabed }),
    );
    floor.name = 'meeresgrund';
    group.add(floor);
  }
  return { mesh: group, tiles, ground: { cells, rgba: ground } };
}

/**
 * Farbvariation im Shader: große, weiche Flecken (heller/dunkler, etwas gelblicher)
 * und feines Rauschen. Bricht die großen einfarbigen Dreiecke auf, kostet kaum etwas.
 */
function addGroundDetail(mat: THREE.MeshLambertMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGroundPos;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 gp = vGroundPos.xz;
          float macro = vnoise(gp / 48.0) * 0.65 + vnoise(gp / 13.0) * 0.35;
          float fine = vnoise(gp / 2.3);
          // nur auf grünen Flächen gelblich/dunkler variieren, Sand und Fels nur in der Helligkeit
          float green = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 8.0, 0.0, 1.0);
          vec3 dry = diffuseColor.rgb * vec3(1.18, 1.08, 0.78);
          diffuseColor.rgb = mix(diffuseColor.rgb, dry, green * smoothstep(0.55, 0.85, macro) * 0.7);
          diffuseColor.rgb *= 0.88 + macro * 0.2 + (fine - 0.5) * 0.06;
        }`,
      );
  };
}

export function createWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(20000, 20000);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: '#3d86c6', transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  return mesh;
}
