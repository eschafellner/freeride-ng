import * as THREE from 'three';

/**
 * Regen: kurze Striche in einem Kasten um die Kamera. Fallen und Mitwandern rechnet der
 * Vertex-Shader, ein Zeichenaufruf, keine Arbeit auf der CPU.
 */

const BOX = { w: 90, h: 46 };
const COUNT = 7000;

export interface Rain {
  mesh: THREE.LineSegments;
  /** Stärke 0 … 1, Zeit in s, Kameraposition. */
  update(strength: number, time: number, camera: THREE.Camera): void;
}

export function createRain(): Rain {
  const pos = new Float32Array(COUNT * 2 * 3);
  const end = new Float32Array(COUNT * 2);
  let s = 12345;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < COUNT; i++) {
    const x = rnd() * BOX.w;
    const y = rnd() * BOX.h;
    const z = rnd() * BOX.w;
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0;
    end[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uStrength: { value: 0 },
    uWind: { value: new THREE.Vector2(2.2, 0.8) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform float uTime;
      uniform vec3 uCam;
      uniform float uStrength;
      uniform vec2 uWind;
      varying float vAlpha;
      const vec3 BOX = vec3(${BOX.w.toFixed(1)}, ${BOX.h.toFixed(1)}, ${BOX.w.toFixed(1)});
      void main() {
        // Nur ein Teil der Tropfen ist bei leichtem Regen sichtbar
        float id = fract(position.x * 12.9898 + position.z * 78.233 + position.y * 3.17);
        float visible = step(id, uStrength);
        float fall = 13.0 + id * 4.0;
        vec3 p = position;
        p.y -= uTime * fall;
        p.xz += uWind * uTime * (fall / 15.0);
        // Kasten um die Kamera: Tropfen wiederholen sich in jeder Richtung
        vec3 origin = uCam - BOX * vec3(0.5, 0.35, 0.5);
        p = origin + mod(p - origin, BOX);
        // Strich in Fallrichtung, Länge ~ Tempo
        vec3 dir = normalize(vec3(uWind.x * fall / 15.0, -fall, uWind.y * fall / 15.0));
        p += dir * aEnd * 0.9;
        float dist = length(p - uCam);
        vAlpha = visible * smoothstep(1.0, 4.0, dist) * (1.0 - smoothstep(25.0, 45.0, dist));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(0.78, 0.82, 0.88, 0.42 * vAlpha);
      }`,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'regen';
  mesh.visible = false;
  return {
    mesh,
    update(strength, time, camera) {
      mesh.visible = strength > 0.01;
      if (!mesh.visible) return;
      uniforms.uStrength.value = strength;
      // Zeit begrenzt halten, damit die Genauigkeit im Shader reicht
      uniforms.uTime.value = time % 600;
      camera.getWorldPosition(uniforms.uCam.value);
    },
  };
}
