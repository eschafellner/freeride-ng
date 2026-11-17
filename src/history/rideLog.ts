/**
 * Aufzeichnung einer Fahrt für die Fahrten-Historie und den Export (TCX/FIT).
 * Reines TS ohne UI und Gerät: Die Spielseite reicht den Zustand der Engine herein.
 *
 * Gespeichert wird ein Messpunkt pro Sekunde Fahrzeit. Pausen bleiben als Lücke in
 * der Uhrzeit sichtbar (Fahrzeit läuft nicht weiter), so erkennen auch Strava & Co.
 * die Pause.
 */

/** Messpunkte spaltenweise (spart Platz in IndexedDB). */
export interface RideTrack {
  /** Uhrzeit in ms seit 1970 (UTC). */
  ts: number[];
  /** Fahrzeit seit Beginn in s (ohne Pausen). */
  time: number[];
  /** Strecke seit Beginn in m. */
  dist: number[];
  /** Tempo in m/s. */
  speed: number[];
  /** Leistung in W (gemessen). */
  power: number[];
  /** Trittfrequenz in U/min. */
  cadence: number[];
  /** Puls in 1/min, 0 = keiner. */
  hr: number[];
  /** Höhe in der Spielwelt in m. */
  alt: number[];
}

export type RideDevice = 'simulator' | 'kettler';

export interface RideSummary {
  distance: number;
  /** Fahrzeit ohne Pausen in s. */
  movingSec: number;
  /** Zeit vom Start bis zum letzten Messpunkt in s (mit Pausen). */
  elapsedSec: number;
  elevationGain: number;
  avgPower: number;
  maxPower: number;
  /** Ø Trittfrequenz, nur Zeit mit Treten. */
  avgCadence: number;
  maxCadence: number;
  /** 0 = kein Puls aufgezeichnet. */
  avgHr: number;
  maxHr: number;
  /** m/s */
  avgSpeed: number;
  maxSpeed: number;
  /** Geleistete Arbeit in kJ (≈ verbrauchte kcal). */
  kj: number;
}

/** Eintrag in der Fahrtenliste (ohne Messpunkte). */
export interface RideMeta {
  version: 1;
  id: string;
  startedAt: number;
  endedAt: number;
  device: RideDevice;
  /** Ort beim Start, z. B. „Hafenplatz“. */
  startPlace?: string;
  summary: RideSummary;
}

/** Ab dieser Länge wird eine Fahrt gespeichert (kurzes Antesten nicht). */
export const MIN_RIDE_SEC = 60;
export const MIN_RIDE_M = 100;

/** Lücke in der Uhrzeit, ab der zwischen zwei Messpunkten eine Pause lag (ms). */
export const PAUSE_GAP_MS = 3000;

export function emptyTrack(): RideTrack {
  return { ts: [], time: [], dist: [], speed: [], power: [], cadence: [], hr: [], alt: [] };
}

/** Ausschnitt aus dem Zustand der Engine, den die Aufzeichnung braucht. */
export interface RideSampleInput {
  timeSec: number;
  distance: number;
  elevationGain: number;
  speed: number;
  power: number;
  cadence: number;
  heartRate: number;
}

export function summarize(track: RideTrack, elevationGain: number): RideSummary {
  const n = track.ts.length;
  const s: RideSummary = {
    distance: 0, movingSec: 0, elapsedSec: 0, elevationGain: Math.max(0, elevationGain),
    avgPower: 0, maxPower: 0, avgCadence: 0, maxCadence: 0, avgHr: 0, maxHr: 0,
    avgSpeed: 0, maxSpeed: 0, kj: 0,
  };
  if (n === 0) return s;
  s.distance = track.dist[n - 1]!;
  s.movingSec = track.time[n - 1]!;
  s.elapsedSec = (track.ts[n - 1]! - track.ts[0]!) / 1000;
  let pSum = 0;
  let cSum = 0;
  let cN = 0;
  let hSum = 0;
  let hN = 0;
  for (let i = 0; i < n; i++) {
    const p = track.power[i]!;
    pSum += p;
    s.maxPower = Math.max(s.maxPower, p);
    const c = track.cadence[i]!;
    if (c > 0) {
      cSum += c;
      cN++;
      s.maxCadence = Math.max(s.maxCadence, c);
    }
    const h = track.hr[i]!;
    if (h > 0) {
      hSum += h;
      hN++;
      s.maxHr = Math.max(s.maxHr, h);
    }
    s.maxSpeed = Math.max(s.maxSpeed, track.speed[i]!);
    // Arbeit über die Fahrzeit zwischen den Punkten
    if (i > 0) s.kj += (p * (track.time[i]! - track.time[i - 1]!)) / 1000;
  }
  s.avgPower = pSum / n;
  s.avgCadence = cN ? cSum / cN : 0;
  s.avgHr = hN ? hSum / hN : 0;
  s.avgSpeed = s.movingSec > 0 ? s.distance / s.movingSec : 0;
  return s;
}

/**
 * Nimmt während der Fahrt einen Messpunkt pro Sekunde Fahrzeit auf.
 * Die Engine zählt Strecke und Zeit über alle Fahrten; die Aufzeichnung merkt sich
 * den Stand beim Start und speichert nur die Differenz.
 */
export class RideRecorder {
  readonly track = emptyTrack();
  readonly id: string;
  private base: RideSampleInput | null = null;
  private lastTime = -Infinity;
  private gain = 0;

  constructor(
    readonly startedAt: number,
    readonly device: RideDevice,
    readonly startPlace?: string,
    /** Abstand der Messpunkte in s Fahrzeit. */
    private readonly interval = 1,
  ) {
    this.id = `ride-${startedAt}`;
  }

  /**
   * Meldet den aktuellen Zustand (bei jedem Bild aufrufen, nur während der Fahrt).
   * @returns true, wenn ein Messpunkt aufgenommen wurde
   */
  sample(nowMs: number, s: RideSampleInput, altitude: number): boolean {
    this.base ??= { ...s };
    const time = s.timeSec - this.base.timeSec;
    if (time - this.lastTime < this.interval - 1e-6) return false;
    this.lastTime = time;
    const t = this.track;
    t.ts.push(Math.round(nowMs));
    t.time.push(round(time, 1));
    t.dist.push(round(Math.max(0, s.distance - this.base.distance), 1));
    t.speed.push(round(s.speed, 2));
    t.power.push(Math.round(s.power));
    t.cadence.push(Math.round(s.cadence));
    t.hr.push(Math.round(s.heartRate));
    t.alt.push(round(altitude, 1));
    this.gain = s.elevationGain - this.base.elevationGain;
    return true;
  }

  get samples(): number {
    return this.track.ts.length;
  }

  summary(): RideSummary {
    return summarize(this.track, this.gain);
  }

  /** Lohnt es sich, die Fahrt zu speichern? */
  worthKeeping(): boolean {
    const s = this.summary();
    return s.movingSec >= MIN_RIDE_SEC && s.distance >= MIN_RIDE_M;
  }

  meta(): RideMeta {
    const n = this.track.ts.length;
    return {
      version: 1,
      id: this.id,
      startedAt: this.startedAt,
      endedAt: n ? this.track.ts[n - 1]! : this.startedAt,
      device: this.device,
      ...(this.startPlace ? { startPlace: this.startPlace } : {}),
      summary: this.summary(),
    };
  }
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Zeitabschnitte ohne Pause (Indizes [von, bis] inklusive), für Start/Stopp im Export. */
export function activeSpans(track: RideTrack): [number, number][] {
  const spans: [number, number][] = [];
  let from = 0;
  for (let i = 1; i <= track.ts.length; i++) {
    if (i === track.ts.length || track.ts[i]! - track.ts[i - 1]! > PAUSE_GAP_MS) {
      if (track.ts.length) spans.push([from, i - 1]);
      from = i;
    }
  }
  return spans;
}

/** Dateiname für den Export, z. B. `freeride-2026-11-17-1830.fit` (Ortszeit). */
export function exportFileName(meta: RideMeta, ext: 'tcx' | 'fit'): string {
  const d = new Date(meta.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `freeride-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/** Beschreibung für Notizen im Export. */
export function rideDescription(meta: RideMeta): string {
  const where = meta.startPlace ? ` ab ${meta.startPlace}` : '';
  const dev = meta.device === 'kettler' ? 'Kettler E5' : 'Simulator';
  return `Freeride NG – virtuelle Fahrt auf Velara${where} (${dev})`;
}
