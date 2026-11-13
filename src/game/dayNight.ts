import * as THREE from 'three';
import { CYCLE_START, lightState, wrapTime, type LightState, type Rgb } from './dayCycle';
import { NIGHT_GLOW } from './houses';
import type { DayNightMode } from './quality';
import { SKY, SKY_EXTRA, SUN_DIR, type SceneBundle } from './scene';

/**
 * Überträgt den Tag-Nacht-Zyklus auf die Szene: Sonne bzw. Mond als
 * Schattenlicht, Himmelslicht, Himmel, Nebel, Wolken, Sterne, Wasser,
 * Lampen und Fenster. Im Modus „Immer Tag“ gilt der feste Tageszustand von früher.
 */
export class DayNight {
  /** Sekunden im Zyklus (0 = Sonnenaufgang). */
  time: number;
  private mode: DayNightMode;
  private readonly cloudMat: THREE.MeshLambertMaterial | null;
  private readonly dayCloud = new THREE.Color('#ffffff');
  private readonly nightCloud = new THREE.Color('#4d5a7a');
  /** Fester Tageszustand (so wie die Szene vor dem Tag-Nacht-Wechsel aussah). */
  private readonly fixedDay: LightState;

  constructor(private readonly bundle: SceneBundle, mode: DayNightMode, startTime = CYCLE_START) {
    this.mode = mode;
    this.time = wrapTime(startTime);
    const mesh = bundle.clouds.children[0] as THREE.Mesh | undefined;
    this.cloudMat = (mesh?.material as THREE.MeshLambertMaterial | undefined) ?? null;
    const srgb = (c: THREE.Color): Rgb => {
      const s = c.clone().convertLinearToSRGB();
      return [s.r, s.g, s.b];
    };
    this.fixedDay = {
      lightDir: [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z],
      lightColor: srgb(SKY.sun), lightIntensity: bundle.sun.intensity, moon: false,
      hemiSky: srgb(bundle.hemi.color), hemiGround: srgb(bundle.hemi.groundColor), hemiIntensity: bundle.hemi.intensity,
      skyTop: srgb(SKY.top), skyHorizon: srgb(SKY.horizon), discColor: srgb(SKY.sun),
      stars: 0, lamps: 0, cloudGlow: 1, daylight: 1,
    };
    this.apply();
  }

  get cycling(): boolean {
    return this.mode === 'zyklus';
  }

  setMode(mode: DayNightMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
  }

  /** Zeit weiterlaufen lassen (nur im Zyklus und während gefahren wird). */
  update(dt: number, running: boolean): void {
    if (this.mode !== 'zyklus' || !running) return;
    this.time = wrapTime(this.time + dt);
    this.apply();
  }

  /** Aktueller Zustand (für Anzeige und Tests). */
  state(): LightState {
    return this.mode === 'zyklus' ? lightState(this.time) : this.fixedDay;
  }

  apply(): void {
    const s = this.state();
    const { sun, hemi, scene } = this.bundle;
    SUN_DIR.set(...s.lightDir).normalize();
    SKY.top.setRGB(...s.skyTop, THREE.SRGBColorSpace);
    SKY.horizon.setRGB(...s.skyHorizon, THREE.SRGBColorSpace);
    SKY.sun.setRGB(...s.discColor, THREE.SRGBColorSpace);
    sun.color.setRGB(...s.lightColor, THREE.SRGBColorSpace);
    sun.intensity = s.lightIntensity;
    hemi.color.setRGB(...s.hemiSky, THREE.SRGBColorSpace);
    hemi.groundColor.setRGB(...s.hemiGround, THREE.SRGBColorSpace);
    hemi.intensity = s.hemiIntensity;
    (scene.fog as THREE.Fog).color.copy(SKY.horizon);
    (scene.background as THREE.Color).copy(SKY.horizon);
    SKY_EXTRA.stars.value = s.stars;
    // Mondhof kleiner als der Sonnenhof
    SKY_EXTRA.halo.value = s.moon ? 0.45 : 1;
    SKY_EXTRA.daylight.value = s.daylight;
    NIGHT_GLOW.value = s.lamps;
    if (this.cloudMat) {
      this.cloudMat.emissiveIntensity = 0.55 * s.cloudGlow;
      this.cloudMat.color.copy(this.nightCloud).lerp(this.dayCloud, s.daylight);
    }
  }
}
