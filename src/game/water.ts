import * as THREE from 'three';
import { LAKE_MESH_EXTENT, LAKES, lakeShape, type LakeDef } from '../world/lakes';
import { SKY, SKY_EXTRA, SUN_DIR } from './scene';
import { NOISE_GLSL, TERRAIN_GLSL, type TerrainUniforms } from './shaderChunks';

/**
 * Meer im Low-Poly-Stil: facettierte Wellen (Normalen aus den Ableitungen),
 * Farbe nach Wassertiefe, Schaum am Ufer und Glitzern der Sonne.
 * Die Wassertiefe kommt aus der Geländehöhe (gleiche Textur wie beim Gras).
 * Die Bergseen nutzen denselben Shader auf ihrer eigenen Höhe, aber fast ohne Wellen,
 * dunkler und mit kräftiger Spiegelung des Himmels.
 */

const WAVES_GLSL = /* glsl */ `
float waveHeight(vec2 p, float t) {
  return sin(p.x * 0.07 + t * 0.9) * 0.3
       + sin(p.y * 0.095 - t * 1.1) * 0.24
       + sin((p.x + p.y) * 0.16 + t * 1.6) * 0.12
       + sin((p.x * 0.7 - p.y) * 0.27 - t * 2.1) * 0.07;
}
`;

export interface Water {
  group: THREE.Group;
  update(time: number): void;
  /** Wellengitter neu aufbauen (Zellgröße in m, 0 = flach). */
  setWaveCell(cell: number): void;
}

const INNER = 4200;

function waveGrid(cell: number): THREE.PlaneGeometry {
  const segs = cell > 0 ? Math.round(INNER / cell) : 1;
  const g = new THREE.PlaneGeometry(INNER, INNER, segs, segs);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Gemeinsame Werte von Meer und Seen (Zeit, Wellen an/aus, Tageslicht). */
interface SharedUniforms {
  uTime: THREE.IUniform<number>;
  uWaves: THREE.IUniform<number>;
}

/**
 * Wassermaterial auf Höhe `level`. `calm` = 1 für Bergseen: kleine Wellen,
 * starke Spiegelung, kaum Schaum.
 */
function waterMaterial(terrain: TerrainUniforms, shared: SharedUniforms, level: number, calm: number): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uSunDir: { value: SUN_DIR },
      uSunColor: { value: SKY.sun },
      uSky: { value: SKY.horizon },
      uShallow: { value: new THREE.Color(calm > 0 ? '#3f8f84' : '#3fb6b4') },
      uDeep: { value: new THREE.Color(calm > 0 ? '#16405a' : '#174f8c') },
      uLevel: { value: level },
      uCalm: { value: calm },
    },
  ]);
  // Zeit, Wellen und Helligkeit des Tageslichts teilen (nicht klonen): nachts wird das Wasser dunkel
  Object.assign(uniforms, shared);
  uniforms.uDaylight = SKY_EXTRA.daylight;
  // Texturen nicht klonen (merge kopiert Werte), sondern teilen
  Object.assign(uniforms, terrain);

  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform float uWaves;
      uniform float uLevel;
      uniform float uCalm;
      ${WAVES_GLSL}
      ${TERRAIN_GLSL}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // Wellen werden zum Ufer hin flacher, auf den Seen sind sie nur ein leichtes Kräuseln
        float depth = max(0.0, uLevel - terrainHeight(wp.xz));
        wp.y += uWaves * waveHeight(wp.xz, uTime) * smoothstep(0.0, 3.0, depth) * mix(1.0, 0.18, uCalm);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSky;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uDaylight;
      uniform float uLevel;
      uniform float uCalm;
      ${NOISE_GLSL}
      ${TERRAIN_GLSL}
      varying vec3 vWorld;
      void main() {
        // Facettierte Normale aus den Bildschirmableitungen (Low-Poly-Look)
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (n.y < 0.0) n = -n;
        vec3 view = normalize(cameraPosition - vWorld);
        float depth = max(0.0, uLevel - terrainHeight(vWorld.xz));

        vec3 col = mix(uShallow, uDeep, smoothstep(0.5, mix(14.0, 6.0, uCalm), depth));
        // Kräftiger Lichtunterschied zwischen den Facetten, damit die Wellen sichtbar werden
        float diffuse = 0.35 + 0.65 * max(0.0, dot(n, uSunDir)) + (n.x * 0.6 + n.z * 0.4) * mix(1.2, 0.5, uCalm);
        col *= diffuse * mix(0.22, 1.0, uDaylight);
        // Himmel spiegelt sich bei flachem Blickwinkel, auf den stillen Seen deutlich
        float fresnel = pow(1.0 - max(0.0, dot(n, view)), mix(5.0, 3.5, uCalm));
        // Auf den Seen spiegelt sich ein kräftigeres Himmelsblau statt des hellen Horizonts
        vec3 sky = mix(uSky, vec3(0.32, 0.52, 0.74), uCalm * 0.6) * mix(0.25, 1.0, uDaylight);
        col = mix(col, sky, fresnel * mix(0.35, 0.55, uCalm));
        // Sonnenglitzern auf den Facetten
        vec3 h = normalize(uSunDir + view);
        float spec = pow(max(0.0, dot(n, h)), 220.0);
        float sparkle = step(0.82, hash12(floor(vWorld.xz * 0.9) + floor(uTime * 3.0)));
        col += uSunColor * spec * (1.2 + sparkle * 2.5) * mix(1.0, 0.6, uCalm);
        // Uferschaum: schmales, bewegtes Band an flachen Stellen (an den Seen nur ein heller Saum)
        float wobble = vnoise(vWorld.xz * 0.15 + uTime * 0.25) * 0.8;
        float foamBand = 1.0 - smoothstep(0.0, 0.9, depth + wobble * 0.6 - 0.2 * sin(uTime * 1.3));
        float foamBits = smoothstep(0.35, 0.75, vnoise(vWorld.xz * 0.9 + vec2(uTime * 0.4, 0.0)));
        float foam = clamp(foamBand * (0.55 + foamBits), 0.0, 1.0) * mix(1.0, 0.25, uCalm);
        col = mix(col, vec3(0.96, 0.98, 1.0) * mix(0.3, 1.0, uDaylight), foam * 0.85);

        float alpha = mix(0.55, 0.96, smoothstep(0.0, 3.0, depth));
        alpha = max(alpha, foam * 0.9);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** Zellgröße des Seegitters in m. */
const LAKE_CELL = 8;

/** Wasserfläche eines Sees: Gitter über die Becken, nur Zellen nahe der Uferlinie und innen. */
export function lakeGeometry(lake: LakeDef, cell = LAKE_CELL): THREE.BufferGeometry {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const l of lake.lobes) {
    const r = Math.max(l.rx, l.rz) * 1.3;
    x0 = Math.min(x0, l.x - r);
    x1 = Math.max(x1, l.x + r);
    z0 = Math.min(z0, l.z - r);
    z1 = Math.max(z1, l.z + r);
  }
  const nx = Math.ceil((x1 - x0) / cell);
  const nz = Math.ceil((z1 - z0) / cell);
  const inside = new Uint8Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) inside[j * (nx + 1) + i] = lakeShape(lake, x0 + i * cell, z0 + j * cell) < LAKE_MESH_EXTENT ? 1 : 0;
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const vert = new Map<number, number>();
  const v = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    let n = vert.get(k);
    if (n === undefined) {
      n = pos.length / 3;
      pos.push(x0 + i * cell, lake.level, z0 + j * cell);
      vert.set(k, n);
    }
    return n;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const any = inside[j * (nx + 1) + i]! | inside[j * (nx + 1) + i + 1]! | inside[(j + 1) * (nx + 1) + i]! | inside[(j + 1) * (nx + 1) + i + 1]!;
      if (!any) continue;
      const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function createWater(waveCell: number, terrain: TerrainUniforms): Water {
  const shared: SharedUniforms = { uTime: { value: 0 }, uWaves: { value: waveCell > 0 ? 1 : 0 } };
  const mat = waterMaterial(terrain, shared, 0, 0);

  const group = new THREE.Group();
  group.name = 'wasser';
  // Wellengitter über der Insel und ihrer Küste, außen eine flache Fläche
  const inner = INNER;
  const nearMesh = new THREE.Mesh(waveGrid(waveCell), mat);
  nearMesh.frustumCulled = false;
  group.add(nearMesh);

  // Außenring aus vier Streifen, damit nichts doppelt gezeichnet wird
  const outer = 20000;
  const band = (outer - inner) / 2;
  for (const [x, z, w, d] of [
    [0, -(inner + band) / 2, outer, band],
    [0, (inner + band) / 2, outer, band],
    [-(inner + band) / 2, 0, band, inner],
    [(inner + band) / 2, 0, band, inner],
  ] as const) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0, z);
    group.add(m);
  }

  // Bergseen auf ihrer eigenen Höhe
  for (const lake of LAKES) {
    const m = new THREE.Mesh(lakeGeometry(lake), waterMaterial(terrain, shared, lake.level, 1));
    m.name = `see-${lake.id}`;
    group.add(m);
  }

  return {
    group,
    update(time) {
      shared.uTime.value = time;
    },
    setWaveCell(cell) {
      nearMesh.geometry.dispose();
      nearMesh.geometry = waveGrid(cell);
      shared.uWaves.value = cell > 0 ? 1 : 0;
    },
  };
}
