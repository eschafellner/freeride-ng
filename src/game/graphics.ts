import * as THREE from 'three';
import { createGrass, type Grass } from './grass';
import { createPostFx, type PostFx } from './postfx';
import type { GraphicsSettings } from './quality';
import type { SceneBundle } from './scene';
import type { TerrainUniforms } from './shaderChunks';
import { createWater, type Water } from './water';

/**
 * Wendet Grafik-Einstellungen zur Laufzeit an, ohne die Seite neu zu laden:
 * Auflösung, Schatten, Gras, Wellen, Umgebungsverdeckung und Bloom.
 */
export class GraphicsController {
  readonly water: Water;
  private grass: Grass | null = null;
  private postfx: PostFx | null = null;
  private current: GraphicsSettings | null = null;

  constructor(
    private readonly bundle: SceneBundle,
    private readonly terrain: TerrainUniforms,
    settings: GraphicsSettings,
  ) {
    this.water = createWater(settings.waveCell, terrain);
    bundle.scene.add(this.water.group);
    this.apply(settings);
  }

  get settings(): GraphicsSettings {
    return this.current!;
  }

  apply(s: GraphicsSettings): void {
    const prev = this.current;
    const { renderer, sun } = this.bundle;

    if (prev?.pixelRatio !== s.pixelRatio) {
      renderer.setPixelRatio(Math.min(s.pixelRatio, window.devicePixelRatio));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.postfx?.resize();
    }

    if (prev?.shadowMapSize !== s.shadowMapSize) {
      sun.castShadow = s.shadowMapSize > 0;
      if (s.shadowMapSize > 0) {
        sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    }

    if (prev?.grassDistance !== s.grassDistance || prev?.grassDensity !== s.grassDensity) {
      if (this.grass) {
        this.bundle.scene.remove(this.grass.group);
        this.grass.dispose();
      }
      this.grass = createGrass(s.grassDistance, s.grassDensity, this.terrain);
      if (this.grass) this.bundle.scene.add(this.grass.group);
    }

    if (prev && prev.waveCell !== s.waveCell) this.water.setWaveCell(s.waveCell);

    if (s.ao || s.bloom) {
      // Die Nachbearbeitung wird erst gebraucht, wenn ein Effekt an ist
      this.postfx ??= createPostFx(this.bundle, () => [this.bundle.sky, this.water.group, ...(this.grass ? [this.grass.group] : [])]);
      this.postfx.setEffects(s.ao, s.bloom);
    }

    this.current = { ...s };
  }

  update(time: number, camera: THREE.Camera): void {
    this.water.update(time);
    this.grass?.update(time, camera);
  }

  render(): void {
    const s = this.current!;
    if (this.postfx && (s.ao || s.bloom)) this.postfx.render();
    else this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
  }
}
