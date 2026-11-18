import * as THREE from 'three';
import { CYCLE_START, lightState, wrapTime, type LightState, type Rgb } from './dayCycle';
import { NIGHT_GLOW } from './houses';
import type { DayNightMode } from './quality';
import { CLOUD_COVER, SKY, SKY_EXTRA, SUN_DIR, type SceneBundle } from './scene';
import { applyWeather, fogRange, LOOKS, type WeatherLook } from './weatherCycle';

/**
 * Überträgt den Tag-Nacht-Zyklus auf die Szene: Sonne bzw. Mond als
 * Schattenlicht, Himmelslicht, Himmel, Nebel, Wolken, Sterne, Wasser,
 * Lampen und Fenster. Im Modus „Immer Tag“ gilt der feste Tageszustand von früher.
 * Darüber legt sich das Wetter (Wolken, grauer Himmel, Nebel).
 */
export class DayNight {
  /** Sekunden im Zyklus (0 = Sonnenaufgang). */
  time: number;
  private mode: DayNightMode;
  private readonly cloudMat: THREE.MeshLambertMaterial | null;
  private readonly dayCloud = new THREE.Color('#ffffff');
  private readonly nightCloud = new THREE.Color('#4d5a7a');
  private readonly rainCloud = new THREE.Color('#8d949c');
  private readonly tmpCloud = new THREE.Color();
  /** Wetter, das auf das Licht wirkt (setzt `Weather` über `setWeather`). */
  private weather: WeatherLook = { ...LOOKS.heiter };
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
    if (this.mode === 'zyklus' && running) this.time = wrapTime(this.time + dt);
    this.apply();
  }

  setWeather(look: WeatherLook): void {
    this.weather = look;
  }

  /** Aktueller Zustand (für Anzeige und Tests), mit Wetter. */
  state(): LightState {
    return applyWeather(this.mode === 'zyklus' ? lightState(this.time) : this.fixedDay, this.weather);
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
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(SKY.horizon);
    const range = fogRange(this.weather);
    fog.near = range.near;
    fog.far = range.far;
    // Im dichten Nebel sieht man keine einzelnen Wolken mehr
    const f = this.weather.fog;
    CLOUD_COVER.value = this.weather.cover * (1 - Math.min(1, Math.max(0, (f - 0.45) / 0.45)));
    (scene.background as THREE.Color).copy(SKY.horizon);
    SKY_EXTRA.stars.value = s.stars;
    // Mondhof kleiner als der Sonnenhof
    SKY_EXTRA.halo.value = (s.moon ? 0.45 : 1) * (1 - this.weather.overcast * 0.9) * (1 - this.weather.fog * 0.7);
    SKY_EXTRA.daylight.value = s.daylight;
    NIGHT_GLOW.value = s.lamps;
    if (this.cloudMat) {
      this.cloudMat.emissiveIntensity = 0.55 * s.cloudGlow;
      this.cloudMat.color.copy(this.nightCloud).lerp(this.tmpCloud.copy(this.dayCloud).lerp(this.rainCloud, this.weather.overcast), s.daylight);
    }
  }
}
