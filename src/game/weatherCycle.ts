import { mulberry32 } from '../world/random';
import type { LightState, Rgb } from './dayCycle';

/**
 * Wetter als reine Rechnung (ohne Three.js, testbar). Rein optisch: Das Wetter ändert
 * nichts an Tempo oder Zielwatt.
 *
 * Eine feste, aus dem Startwert erzeugte Folge von Wetterlagen. Jede hält einige
 * Minuten Fahrzeit, der Übergang zur nächsten dauert `WEATHER.blend` Sekunden.
 * Die Zeit läuft wie beim Tag-Nacht-Zyklus nur während der Fahrt.
 */

export type WeatherKind = 'klar' | 'heiter' | 'bewoelkt' | 'bedeckt' | 'nebel' | 'regen';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  klar: 'Klar',
  heiter: 'Heiter',
  bewoelkt: 'Bewölkt',
  bedeckt: 'Bedeckt',
  nebel: 'Nebel',
  regen: 'Regen',
};

export const WEATHER_KINDS = Object.keys(WEATHER_LABEL) as WeatherKind[];

/** Aussehen einer Wetterlage, alle Werte 0 … 1. */
export interface WeatherLook {
  /** Anteil der Wolken am Himmel. */
  cover: number;
  /** Grauer Himmel, gedämpfte Sonne. */
  overcast: number;
  /** Dunst und Nebel (kürzere Sichtweite). */
  fog: number;
  /** Regenstärke. */
  rain: number;
}

export const LOOKS: Record<WeatherKind, WeatherLook> = {
  klar: { cover: 0.12, overcast: 0, fog: 0, rain: 0 },
  heiter: { cover: 0.32, overcast: 0, fog: 0, rain: 0 },
  bewoelkt: { cover: 0.62, overcast: 0.3, fog: 0.1, rain: 0 },
  bedeckt: { cover: 0.95, overcast: 0.65, fog: 0.2, rain: 0 },
  nebel: { cover: 0.5, overcast: 0.5, fog: 1, rain: 0 },
  regen: { cover: 1, overcast: 0.85, fog: 0.4, rain: 1 },
};

export const WEATHER = {
  /** Dauer einer Wetterlage in s Fahrzeit (min … max). */
  minHold: 4 * 60,
  maxHold: 9 * 60,
  /** Überblendung zur nächsten Lage in s. */
  blend: 90,
  /** Jede Fahrt beginnt mit dieser Lage. */
  start: 'heiter' as WeatherKind,
};

/**
 * Wahrscheinlichkeiten für die nächste Lage. Das Wetter wechselt eher schrittweise
 * (heiter → bewölkt → bedeckt → Regen) als sprunghaft; schönes Wetter überwiegt.
 */
const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  klar: [['heiter', 0.7], ['bewoelkt', 0.2], ['nebel', 0.1]],
  heiter: [['klar', 0.35], ['bewoelkt', 0.5], ['nebel', 0.15]],
  bewoelkt: [['heiter', 0.45], ['bedeckt', 0.4], ['nebel', 0.15]],
  bedeckt: [['regen', 0.5], ['bewoelkt', 0.4], ['nebel', 0.1]],
  nebel: [['heiter', 0.5], ['bewoelkt', 0.5]],
  regen: [['bedeckt', 0.55], ['bewoelkt', 0.45]],
};

export interface WeatherSegment {
  kind: WeatherKind;
  /** Beginn in s (ab hier wird von der vorigen Lage herübergeblendet). */
  start: number;
}

/** Wetterfolge aus einem Startwert; wird bei Bedarf verlängert. */
export class WeatherTimeline {
  private readonly rng: () => number;
  readonly segments: WeatherSegment[] = [];

  constructor(seed: number, first: WeatherKind = WEATHER.start) {
    this.rng = mulberry32(seed ^ 0x5eed);
    this.segments.push({ kind: first, start: 0 });
  }

  private extend(until: number): void {
    let last = this.segments[this.segments.length - 1]!;
    while (last.start <= until) {
      const hold = WEATHER.minHold + this.rng() * (WEATHER.maxHold - WEATHER.minHold);
      let r = this.rng();
      let kind = NEXT[last.kind][0]![0];
      for (const [k, p] of NEXT[last.kind]) {
        if (r < p) {
          kind = k;
          break;
        }
        r -= p;
      }
      last = { kind, start: last.start + hold };
      this.segments.push(last);
    }
  }

  /** Lage, die zur Zeit t gilt (bzw. in die gerade übergeblendet wird). */
  kindAt(t: number): WeatherKind {
    return this.segmentAt(t).seg.kind;
  }

  private segmentAt(t: number): { seg: WeatherSegment; prev: WeatherSegment | null } {
    const time = Math.max(0, t);
    this.extend(time + 1);
    let k = 0;
    while (k + 1 < this.segments.length && this.segments[k + 1]!.start <= time) k++;
    return { seg: this.segments[k]!, prev: k > 0 ? this.segments[k - 1]! : null };
  }

  /** Aussehen zur Zeit t, mit weicher Überblendung am Beginn jeder Lage. */
  lookAt(t: number): WeatherLook {
    const { seg, prev } = this.segmentAt(t);
    const to = LOOKS[seg.kind];
    if (!prev) return { ...to };
    const x = Math.min(1, Math.max(0, (t - seg.start) / WEATHER.blend));
    return mixLook(LOOKS[prev.kind], to, x * x * (3 - 2 * x));
  }
}

export function mixLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
  return {
    cover: a.cover + (b.cover - a.cover) * t,
    overcast: a.overcast + (b.overcast - a.overcast) * t,
    fog: a.fog + (b.fog - a.fog) * t,
    rain: a.rain + (b.rain - a.rain) * t,
  };
}

/**
 * Regionale Eigenheiten: In der Glutsteppe regnet es nicht und Dunst ist selten,
 * am Nordkap zieht leicht Seenebel auf.
 * @param steppe Anteil Glutsteppe 0 … 1, @param coast Anteil Nordkap 0 … 1
 */
export function localLook(look: WeatherLook, steppe: number, coast: number): WeatherLook {
  const rain = look.rain * (1 - steppe);
  return {
    cover: look.cover * (1 - 0.35 * steppe),
    overcast: look.overcast * (1 - 0.5 * steppe),
    fog: Math.min(1, look.fog * (1 - 0.6 * steppe) + 0.3 * coast * (1 - steppe)),
    rain,
  };
}

/** Sichtweite des Nebels (Beginn und volle Deckung in m) zum Aussehen. */
export function fogRange(look: WeatherLook): { near: number; far: number } {
  const f = look.fog;
  return { near: 450 * (1 - f) + 15 * f, far: 2800 * (1 - f) ** 1.6 + 260 * f };
}

const GREY_DAY: Rgb = [0.72, 0.75, 0.78];
const GREY_TOP: Rgb = [0.55, 0.6, 0.66];
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Helligkeit einer Farbe beibehalten, aber Richtung Grau ziehen. */
const toGrey = (c: Rgb, grey: Rgb, t: number): Rgb => {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const gl = 0.3 * grey[0] + 0.59 * grey[1] + 0.11 * grey[2];
  const scaled: Rgb = [grey[0] * (l / gl), grey[1] * (l / gl), grey[2] * (l / gl)];
  return mixRgb(c, scaled, t);
};

/**
 * Licht des Tag-Nacht-Zyklus unter dem Wetter: Wolken dämpfen Sonne bzw. Mond,
 * der Himmel wird grau, Sterne verschwinden hinter der Wolkendecke.
 */
export function applyWeather(s: LightState, look: WeatherLook): LightState {
  const o = look.overcast;
  const grey = Math.max(o, look.fog * 0.85);
  return {
    ...s,
    lightIntensity: s.lightIntensity * (1 - 0.78 * o) * (1 - 0.4 * look.fog),
    hemiIntensity: s.hemiIntensity * (1 - 0.3 * o),
    hemiSky: toGrey(s.hemiSky, GREY_DAY, o * 0.8),
    skyTop: toGrey(s.skyTop, GREY_TOP, grey),
    skyHorizon: toGrey(s.skyHorizon, GREY_DAY, grey * 0.9),
    // Bei dichter Decke keine Scheibe mehr sichtbar: Farbe Richtung Horizont
    discColor: mixRgb(s.discColor, toGrey(s.skyHorizon, GREY_DAY, grey), Math.min(1, o * 1.2 + look.fog * 0.6)),
    stars: s.stars * (1 - Math.min(1, look.cover * 1.1)) * (1 - look.fog),
    cloudGlow: s.cloudGlow * (1 - 0.6 * o),
  };
}
