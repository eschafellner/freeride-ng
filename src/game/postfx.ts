import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { SceneBundle } from './scene';

/**
 * Nachbearbeitung: Umgebungsverdeckung (GTAO) für
 * Kontaktschatten an Häusern, Bäumen und Bordsteinen, dazu dezentes Bloom für
 * Sonne und Glitzern. Tone Mapping macht dann der OutputPass.
 */
export interface PostFx {
  render(): void;
  setEffects(ao: boolean, bloom: boolean): void;
  /** Nach Änderung der Auflösung. */
  resize(): void;
}

/**
 * @param exclude Objekte mit eigenen Vertex-Shadern (Gras, Wasser, Himmel): GTAO zeichnet
 *   die Szene mit einem Ersatzmaterial neu, das ihre Verschiebung nicht kennt
 */
export function createPostFx(bundle: SceneBundle, exclude: () => THREE.Object3D[]): PostFx {
  const { renderer, scene, camera } = bundle;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
  gtao.blendIntensity = 0.75;
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (...args: Parameters<GTAOPass['render']>) => {
    const hidden = exclude();
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    gtaoRender(...args);
    hidden.forEach((o, i) => (o.visible = was[i]!));
  };
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  };
  bundle.onResize = resize;
  resize();

  return {
    render: () => composer.render(),
    setEffects(ao, b) {
      gtao.enabled = ao;
      bloom.enabled = b;
    },
    resize,
  };
}
