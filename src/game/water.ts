import * as THREE from 'three';
import { SKY, SUN_DIR } from './scene';
import { NOISE_GLSL, TERRAIN_GLSL, type TerrainUniforms } from './shaderChunks';

/**
 * Meer im Low-Poly-Stil: facettierte Wellen (Normalen aus den Ableitungen),
 * Farbe nach Wassertiefe, Schaum am Ufer und Glitzern der Sonne.
 * Die Wassertiefe kommt aus der Geländehöhe (gleiche Textur wie beim Gras).
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

export function createWater(waveCell: number, terrain: TerrainUniforms): Water {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR },
      uSunColor: { value: SKY.sun },
      uSky: { value: SKY.horizon },
      uShallow: { value: new THREE.Color('#3fb6b4') },
      uDeep: { value: new THREE.Color('#174f8c') },
      uWaves: { value: waveCell > 0 ? 1 : 0 },
    },
  ]);
  // Texturen nicht klonen (merge kopiert Werte), sondern teilen
  Object.assign(uniforms, terrain);

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform float uWaves;
      ${WAVES_GLSL}
      ${TERRAIN_GLSL}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // Wellen werden zum Ufer hin flacher
        float depth = max(0.0, -terrainHeight(wp.xz));
        wp.y += uWaves * waveHeight(wp.xz, uTime) * smoothstep(0.0, 3.0, depth);
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
      ${NOISE_GLSL}
      ${TERRAIN_GLSL}
      varying vec3 vWorld;
      void main() {
        // Facettierte Normale aus den Bildschirmableitungen (Low-Poly-Look)
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (n.y < 0.0) n = -n;
        vec3 view = normalize(cameraPosition - vWorld);
        float depth = max(0.0, -terrainHeight(vWorld.xz));

        vec3 col = mix(uShallow, uDeep, smoothstep(0.5, 14.0, depth));
        // Kräftiger Lichtunterschied zwischen den Facetten, damit die Wellen sichtbar werden
        float diffuse = 0.35 + 0.65 * max(0.0, dot(n, uSunDir)) + (n.x * 0.6 + n.z * 0.4) * 1.2;
        col *= diffuse;
        // Himmel spiegelt sich bei flachem Blickwinkel
        float fresnel = pow(1.0 - max(0.0, dot(n, view)), 5.0);
        col = mix(col, uSky, fresnel * 0.35);
        // Sonnenglitzern auf den Facetten
        vec3 h = normalize(uSunDir + view);
        float spec = pow(max(0.0, dot(n, h)), 220.0);
        float sparkle = step(0.82, hash12(floor(vWorld.xz * 0.9) + floor(uTime * 3.0)));
        col += uSunColor * spec * (1.2 + sparkle * 2.5);
        // Uferschaum: schmales, bewegtes Band an flachen Stellen
        float wobble = vnoise(vWorld.xz * 0.15 + uTime * 0.25) * 0.8;
        float foamBand = 1.0 - smoothstep(0.0, 0.9, depth + wobble * 0.6 - 0.2 * sin(uTime * 1.3));
        float foamBits = smoothstep(0.35, 0.75, vnoise(vWorld.xz * 0.9 + vec2(uTime * 0.4, 0.0)));
        float foam = clamp(foamBand * (0.55 + foamBits), 0.0, 1.0);
        col = mix(col, vec3(0.96, 0.98, 1.0), foam * 0.85);

        float alpha = mix(0.55, 0.96, smoothstep(0.0, 3.0, depth));
        alpha = max(alpha, foam * 0.9);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

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

  return {
    group,
    update(time) {
      uniforms.uTime!.value = time;
    },
    setWaveCell(cell) {
      nearMesh.geometry.dispose();
      nearMesh.geometry = waveGrid(cell);
      uniforms.uWaves!.value = cell > 0 ? 1 : 0;
    },
  };
}
