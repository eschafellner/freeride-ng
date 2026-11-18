/**
 * Grafik-Einstellungen: drei Voreinstellungen und frei einstellbare Werte.
 * Gespeichert im localStorage (nur eine Bequemlichkeit pro Browser, kein Spielstand).
 */

export type QualityLevel = 'niedrig' | 'mittel' | 'hoch';

export interface GraphicsSettings {
  /** Zuletzt gewählte Voreinstellung, 'eigene' nach Änderungen an einzelnen Reglern. */
  preset: QualityLevel | 'eigene';
  /** Obergrenze für devicePixelRatio (Bildschärfe). */
  pixelRatio: number;
  /** Kantenlänge der Shadow-Map, 0 = keine Schatten. */
  shadowMapSize: number;
  /** Sichtweite des Grases in m (0 = kein Gras). */
  grassDistance: number;
  /** Grasbüschel pro m² in der Nähe. */
  grassDensity: number;
  /** Zellgröße des Wellengitters in m (0 = flaches Wasser). */
  waveCell: number;
  /** Umgebungsverdeckung (Kontaktschatten). */
  ao: boolean;
  bloom: boolean;
  /** Faktor für die Entfernung, bis zu der Detailmodelle gezeigt werden (1 = Standard). */
  detailDistance: number;
  /** Oberflächen der Häuser (Putz, Ziegel, Fachwerk) im Shader. */
  surfaces: boolean;
  /** Aussehen der Anzeige (keine Grafiklast, wird von Voreinstellungen nicht verändert). */
  hud: HudStyle;
  /** Immer Tag oder Tag-Nacht-Zyklus (keine Grafiklast, bleibt bei Voreinstellungen erhalten). */
  dayNight: DayNightMode;
  /** Wechselndes Wetter oder immer schön (bleibt bei Voreinstellungen erhalten). */
  weather: WeatherMode;
  /** Lautstärke der Geräusche 0 … 1, 0 = aus (bleibt bei Voreinstellungen erhalten). */
  volume: number;
}

export type WeatherMode = 'wechselnd' | 'schoen';

export type DayNightMode = 'tag' | 'zyklus';

export type HudStyle = 'standard' | 'radcomputer';

export const PRESETS: Record<QualityLevel, Omit<GraphicsSettings, 'preset' | 'hud' | 'dayNight' | 'weather' | 'volume'>> = {
  niedrig: { pixelRatio: 1, shadowMapSize: 1024, grassDistance: 0, grassDensity: 4, waveCell: 0, ao: false, bloom: false, detailDistance: 0.6, surfaces: false },
  mittel: { pixelRatio: 1.5, shadowMapSize: 2048, grassDistance: 70, grassDensity: 6, waveCell: 16, ao: false, bloom: false, detailDistance: 1, surfaces: true },
  hoch: { pixelRatio: 2, shadowMapSize: 4096, grassDistance: 120, grassDensity: 9, waveCell: 8, ao: true, bloom: true, detailDistance: 1.5, surfaces: true },
};

export const DEFAULT_VOLUME = 0.6;

export const QUALITY_LABEL: Record<QualityLevel | 'eigene', string> = {
  niedrig: 'Niedrig',
  mittel: 'Mittel',
  hoch: 'Hoch',
  eigene: 'Eigene',
};

/** Grenzen der Regler im Grafikmenü. */
export const LIMITS = {
  grassDistance: { min: 0, max: 200, step: 10 },
  grassDensity: { min: 2, max: 12, step: 1 },
  pixelRatio: { min: 0.75, max: 2, step: 0.25 },
  detailDistance: { min: 0.5, max: 2, step: 0.25 },
  volume: { min: 0, max: 1, step: 0.05 },
  shadowMapSize: [0, 1024, 2048, 4096] as const,
  waveCell: [0, 16, 8] as const,
};

export function presetSettings(
  level: QualityLevel, hud: HudStyle = 'standard', dayNight: DayNightMode = 'zyklus', weather: WeatherMode = 'wechselnd',
  volume = DEFAULT_VOLUME,
): GraphicsSettings {
  return { preset: level, ...PRESETS[level], hud, dayNight, weather, volume };
}

const KEY = 'freeride-ng.graphics';

const isLevel = (v: unknown): v is QualityLevel => v === 'niedrig' || v === 'mittel' || v === 'hoch';
const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const oneOf = <T extends number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Prüft gespeicherte Einstellungen; Unbrauchbares fällt auf „mittel“ zurück. */
export function sanitizeSettings(raw: unknown): GraphicsSettings {
  const base = presetSettings('mittel');
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GraphicsSettings>;
  return {
    preset: isLevel(r.preset) || r.preset === 'eigene' ? r.preset : base.preset,
    pixelRatio: clampNum(r.pixelRatio, LIMITS.pixelRatio.min, LIMITS.pixelRatio.max, base.pixelRatio),
    shadowMapSize: oneOf(r.shadowMapSize, LIMITS.shadowMapSize, base.shadowMapSize as 2048),
    grassDistance: clampNum(r.grassDistance, LIMITS.grassDistance.min, LIMITS.grassDistance.max, base.grassDistance),
    grassDensity: clampNum(r.grassDensity, LIMITS.grassDensity.min, LIMITS.grassDensity.max, base.grassDensity),
    waveCell: oneOf(r.waveCell, LIMITS.waveCell, base.waveCell as 16),
    ao: typeof r.ao === 'boolean' ? r.ao : base.ao,
    bloom: typeof r.bloom === 'boolean' ? r.bloom : base.bloom,
    detailDistance: clampNum(r.detailDistance, LIMITS.detailDistance.min, LIMITS.detailDistance.max, base.detailDistance),
    surfaces: typeof r.surfaces === 'boolean' ? r.surfaces : base.surfaces,
    hud: r.hud === 'radcomputer' ? 'radcomputer' : 'standard',
    dayNight: r.dayNight === 'tag' ? 'tag' : 'zyklus',
    weather: r.weather === 'schoen' ? 'schoen' : 'wechselnd',
    volume: clampNum(r.volume, LIMITS.volume.min, LIMITS.volume.max, DEFAULT_VOLUME),
  };
}

/** URL (`?quality=hoch`) vor gespeicherten Einstellungen vor Standard „mittel“. */
export function loadSettings(search = location.search): GraphicsSettings {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('quality');
  if (isLevel(fromUrl)) {
    return presetSettings(fromUrl, params.get('hud') === 'radcomputer' ? 'radcomputer' : 'standard', params.get('tag') !== null ? 'tag' : 'zyklus',
      params.get('schoen') !== null ? 'schoen' : 'wechselnd');
  }
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return sanitizeSettings(JSON.parse(stored));
  } catch {
    // Speicher gesperrt oder kaputt: Standard
  }
  return presetSettings('mittel');
}

export function storeSettings(s: GraphicsSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neuladen
  }
}
