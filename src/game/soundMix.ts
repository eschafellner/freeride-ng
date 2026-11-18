/**
 * Mischung der Geräusche als reine Rechnung (ohne Web Audio, testbar): Aus Fahrt,
 * Wetter, Tageszeit und Umgebung ergeben sich Lautstärken und Raten der einzelnen
 * Klangschichten. `audio.ts` setzt sie in Klang um.
 */

export interface SoundInput {
  /** Tempo in m/s. */
  speed: number;
  /** Trittfrequenz in U/min. */
  cadence: number;
  /** Schotter statt Asphalt. */
  gravel: boolean;
  /** Pause oder Menü: nur leise Umgebung. */
  paused: boolean;
  /** Regenstärke 0 … 1. */
  rain: number;
  /** Bewölkung 0 … 1 (bei grauem Himmel singen weniger Vögel). */
  overcast: number;
  /** Tageslicht 0 (Nacht) … 1 (Tag). */
  daylight: number;
  /** Wie nah das Meer ist, 0 … 1. */
  sea: number;
  /** Anteil Glutsteppe 0 … 1 (trocken, kaum Vögel). */
  steppe: number;
  /** Anteil Nordkap 0 … 1 (Möwen, mehr Wind). */
  coast: number;
  /** Höhe über dem Meer in m (oben weht mehr Wind). */
  height: number;
}

export interface SoundMix {
  /** Fahrtwind: Lautstärke und Filterfrequenz in Hz. */
  wind: { gain: number; cutoff: number };
  /** Abrollgeräusch der Reifen; `grain` = Knirschen auf Schotter. */
  tyre: { gain: number; cutoff: number; grain: number };
  /** Klicken des Freilaufs pro Sekunde (0 = tritt oder steht). */
  freewheel: number;
  /** Brandung. */
  sea: number;
  rain: number;
  /** Vogelrufe pro Minute. */
  birds: number;
  /** Grillen (nachts). */
  crickets: number;
  /** Möwenrufe pro Minute. */
  gulls: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function soundMix(i: SoundInput): SoundMix {
  const v = i.paused ? 0 : Math.max(0, i.speed);
  const moving = clamp01(v / 1.5);
  // Fahrtwind wächst etwa mit dem Quadrat des Tempos (Luftwiderstand), bei 50 km/h voll
  const air = clamp01((v / 14) ** 2);
  const breeze = 0.06 + 0.08 * i.coast + 0.06 * clamp01((i.height - 300) / 400);
  const amb = i.paused ? 0.5 : 1;
  const day = clamp01(i.daylight);
  const pedalling = i.cadence > 15;
  return {
    wind: { gain: Math.min(0.9, breeze * amb + 0.75 * air), cutoff: 350 + 1600 * air + 200 * i.coast },
    tyre: {
      gain: moving * (0.1 + 0.25 * clamp01(v / 12)) * (i.gravel ? 1.5 : 1),
      cutoff: 250 + 60 * v,
      grain: i.gravel ? moving * (0.25 + 0.4 * clamp01(v / 10)) : 0,
    },
    // Rollen ohne zu treten: der Freilauf klickt schneller, je schneller man fährt
    freewheel: !pedalling && v > 1.5 ? Math.min(40, 3 * v) : 0,
    sea: clamp01(i.sea) * 0.55 * amb,
    rain: clamp01(i.rain) * 0.5 * amb,
    birds: 9 * day * (1 - i.rain) * (1 - 0.6 * i.overcast) * (1 - 0.85 * i.steppe) * (1 - 0.5 * i.coast) * (1 - 0.7 * clamp01(i.sea)),
    crickets: 0.12 * clamp01(1 - day * 2.5) * (1 - i.rain) * (1 - 0.6 * i.coast) * amb,
    gulls: 6 * clamp01(Math.max(i.sea, i.coast)) * (1 - 0.7 * i.rain) * (0.3 + 0.7 * day),
  };
}

/** Nähe zum Meer aus Höhenproben rund um den Fahrer (Anteil Wasser, nah stärker gewichtet). */
export function seaNearness(sample: (x: number, z: number) => number, x: number, z: number): number {
  let wet = 0;
  let total = 0;
  for (const [r, w] of [[40, 1], [110, 0.7], [220, 0.4]] as const) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (sample(x + Math.cos(a) * r, z + Math.sin(a) * r) < 0) wet += w;
      total += w;
    }
  }
  // Schon ein Viertel Wasser ringsum (Küste) zählt fast voll
  return Math.min(1, (wet / total) * 2.5);
}
