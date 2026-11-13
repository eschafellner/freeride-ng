/**
 * Tag-Nacht-Zyklus als reine Rechnung (ohne Three.js, testbar).
 *
 * Ein Tag dauert 30 Minuten: 18 Minuten Tag, danach 12 Minuten Nacht. Die Nacht
 * beginnt mit 1 Minute Abenddämmerung und endet mit 1 Minute Morgendämmerung.
 * Auf der Uhr: Sonnenaufgang 6:00, Sonnenuntergang 18:00, Dämmerung je eine Stunde.
 *
 * t = 0 ist Sonnenaufgang (Ende der Morgendämmerung).
 */

export const CYCLE = {
  /** Länge eines ganzen Tages in Sekunden. */
  length: 30 * 60,
  /** Sonne über dem Horizont. */
  day: 18 * 60,
  /** Abend- und Morgendämmerung (Teil der Nacht). */
  twilight: 60,
} as const;

/** Startzeit beim Laden: früher Vormittag (Sonne schon etwas höher). */
export const CYCLE_START = 150;

export type DayPhase = 'tag' | 'abenddaemmerung' | 'nacht' | 'morgendaemmerung';

const NIGHT = CYCLE.length - CYCLE.day;

/** Zeit in den Zyklus legen (0 … length). */
export function wrapTime(t: number): number {
  return ((t % CYCLE.length) + CYCLE.length) % CYCLE.length;
}

export function phaseOf(t: number): DayPhase {
  const c = wrapTime(t);
  if (c < CYCLE.day) return 'tag';
  if (c < CYCLE.day + CYCLE.twilight) return 'abenddaemmerung';
  if (c < CYCLE.length - CYCLE.twilight) return 'nacht';
  return 'morgendaemmerung';
}

/**
 * Winkel der Sonne auf ihrer Bahn (0 = Aufgang im Osten, π = Untergang im Westen,
 * π … 2π unter dem Horizont). Am Tag läuft sie langsamer als in der Nacht.
 */
export function sunAngle(t: number): number {
  const c = wrapTime(t);
  if (c < CYCLE.day) return (Math.PI * c) / CYCLE.day;
  return Math.PI + (Math.PI * (c - CYCLE.day)) / NIGHT;
}

/** Uhrzeit (0 … 24 h): Tag 6–18 Uhr, Nacht 18–6 Uhr. */
export function clockHours(t: number): number {
  const c = wrapTime(t);
  const h = c < CYCLE.day ? 6 + (12 * c) / CYCLE.day : 18 + (12 * (c - CYCLE.day)) / NIGHT;
  return h % 24;
}

/** Zykluszeit zu einer Uhrzeit (Umkehrung von clockHours), z. B. für `&uhr=21`. */
export function timeForClock(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  if (h >= 6 && h < 18) return ((h - 6) / 12) * CYCLE.day;
  const sinceDusk = h >= 18 ? h - 18 : h + 6;
  return CYCLE.day + (sinceDusk / 12) * NIGHT;
}

export function formatClock(t: number): string {
  const h = clockHours(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

/** Richtung zu einem Himmelskörper auf einer Bahn von Ost über Süd nach West. */
export function arcDirection(angle: number): [number, number, number] {
  const up = Math.sin(angle);
  const x = Math.cos(angle);
  const y = up * 0.95;
  const z = 0.15 + 0.4 * Math.max(0, up);
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

export type Rgb = [number, number, number];

/** Licht und Himmel zu einem Zeitpunkt. Farben als sRGB 0…1. */
export interface LightState {
  /** Richtung der schattenwerfenden Lichtquelle (Sonne, nachts Mond). */
  lightDir: [number, number, number];
  lightColor: Rgb;
  lightIntensity: number;
  /** Ist die Lichtquelle gerade der Mond? */
  moon: boolean;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  skyTop: Rgb;
  skyHorizon: Rgb;
  /** Farbe der Scheibe am Himmel (Sonne oder Mond). */
  discColor: Rgb;
  /** Sterne 0 … 1. */
  stars: number;
  /** Lampen und Fenster 0 … 1. */
  lamps: number;
  /** Wolken leuchten am Tag leicht von selbst. */
  cloudGlow: number;
  /** Tageslicht 0 (Nacht) … 1 (Tag). */
  daylight: number;
}

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Farben und Stärken der drei Zustände Tag, Dämmerung, Nacht. */
export const PALETTE = {
  day: {
    skyTop: hex('#3f86d4'), skyHorizon: hex('#d4e7f3'), sun: hex('#fff1d6'),
    hemiSky: hex('#d8ecff'), hemiGround: hex('#6b7f45'), hemi: 1.25, light: 2.6,
  },
  dusk: {
    skyTop: hex('#4b5d9a'), skyHorizon: hex('#f0a46c'), sun: hex('#ffad66'),
    hemiSky: hex('#d9b7a8'), hemiGround: hex('#5a5640'),
  },
  // Mondnacht, etwa Stufe 6 von 10: deutlich dunkel und blau, aber Wege und Häuser gut erkennbar
  night: {
    skyTop: hex('#0b1631'), skyHorizon: hex('#2a3a5e'), moon: hex('#dfe7ff'),
    hemiSky: hex('#7f95c8'), hemiGround: hex('#2a3140'), hemi: 0.55, light: 0.7, moonLight: hex('#a9bcff'),
  },
} as const;

/** Sinus der Sonnenhöhe, bei der die Dämmerung endet (1 Minute nach Untergang). */
export const TWILIGHT_ELEVATION = -Math.sin((Math.PI * CYCLE.twilight) / NIGHT);

export function lightState(t: number): LightState {
  const angle = sunAngle(t);
  const e = Math.sin(angle);
  const { day, dusk, night } = PALETTE;
  // 0 = tiefe Nacht, 1 = voller Tag; die Dämmerung liegt zwischen Untergang und TWILIGHT_ELEVATION
  const daylight = smooth(TWILIGHT_ELEVATION, 0.22, e);
  // Abendrot: am stärksten um den Horizont
  const golden = Math.max(0, 1 - Math.abs(e - 0.02) / 0.22) * smooth(TWILIGHT_ELEVATION * 1.05, -0.02, e);

  const skyTop = mix(mix(night.skyTop, day.skyTop, daylight), dusk.skyTop, golden * 0.7);
  const skyHorizon = mix(mix(night.skyHorizon, day.skyHorizon, daylight), dusk.skyHorizon, golden);
  const hemiSky = mix(mix(night.hemiSky, day.hemiSky, daylight), dusk.hemiSky, golden * 0.6);
  const hemiGround = mix(mix(night.hemiGround, day.hemiGround, daylight), dusk.hemiGround, golden * 0.5);
  const hemiIntensity = night.hemi + (day.hemi - night.hemi) * daylight;

  // Lichtquelle: Sonne bis zur Mitte der Dämmerung, danach der Mond (dort sind beide fast aus)
  const moon = e < TWILIGHT_ELEVATION / 2;
  let lightDir: [number, number, number];
  let lightColor: Rgb;
  let lightIntensity: number;
  let discColor: Rgb;
  if (!moon) {
    lightDir = arcDirection(angle);
    lightColor = mix(dusk.sun, day.sun, smooth(0, 0.3, e));
    lightIntensity = day.light * smooth(-0.04, 0.25, e);
    discColor = lightColor;
  } else {
    const moonAngle = angle - Math.PI;
    lightDir = arcDirection(moonAngle);
    lightColor = night.moonLight;
    // Ab dem Umschaltpunkt weich einblenden (dort sind Sonne und Mond beide aus)
    lightIntensity = night.light * smooth(0, 0.25, Math.sin(moonAngle)) * smooth(TWILIGHT_ELEVATION / 2, TWILIGHT_ELEVATION, e);
    discColor = night.moon;
  }

  return {
    lightDir, lightColor, lightIntensity, moon,
    hemiSky, hemiGround, hemiIntensity,
    skyTop, skyHorizon, discColor,
    stars: 1 - smooth(TWILIGHT_ELEVATION * 1.2, -0.02, e),
    lamps: 1 - smooth(TWILIGHT_ELEVATION * 0.6, 0.06, e),
    cloudGlow: 0.15 + 0.85 * daylight,
    daylight,
  };
}
