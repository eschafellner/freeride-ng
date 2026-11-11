import type { Measurement } from '../device/types';
import { Gearbox, speedFromCadence, WHEEL_CIRCUMFERENCE_M } from './gears';
import { DEFAULT_PHYSICS, powerRequired, stepSpeed, type PhysicsParams } from './physics';

/**
 * Ride-Engine: reines TypeScript ohne UI und ohne Geräte-Abhängigkeit.
 *
 * Eingang:  Messwerte vom Gerät (setMeasurement) und die aktuelle Steigung (update)
 * Ausgang:  Tempo, Distanz, Höhenmeter und die Zielwatt für das Gerät
 *
 * Modi:
 * - 'sim':    virtuelle Gänge. Aus Kadenz und Gang ergibt sich ein Wunschtempo,
 *             die Engine berechnet die dafür nötigen Watt bei der aktuellen Steigung.
 * - 'simple': Zielwatt = Grundleistung × (1 + k × Steigung in %).
 * - 'erg':    feste Zielwatt (für späteren Trainingsmodus).
 *
 * In allen Modi kommt das Tempo aus der Physik mit der *gemessenen* Leistung.
 * Bergab fällt die Zielleistung aufs Minimum, man rollt.
 */

export type RideMode = 'sim' | 'simple' | 'erg';

export interface RideConfig {
  physics: PhysicsParams;
  mode: RideMode;
  /** Anteil der echten Steigung, der als Widerstand spürbar wird (0.5–1.0). */
  difficulty: number;
  minWatts: number;
  maxWatts: number;
  /** Maximaler Anstieg der Zielwatt in W/s (Abfallen ist sofort erlaubt). */
  maxRiseWattsPerSec: number;
  /** Zeitkonstante der Glättung der Zielwatt in s. */
  smoothingSec: number;
  /** 'simple': Grundleistung in W. */
  simpleBaseWatts: number;
  /** 'simple': k in Zielwatt = Basis × (1 + k × Steigung%). */
  simpleK: number;
  /** 'erg': feste Zielwatt. */
  ergWatts: number;
  /** Messwerte älter als das gelten als verloren (Leistung und Kadenz 0). */
  staleAfterMs: number;
  wheelCircumferenceM: number;
}

export const DEFAULT_RIDE_CONFIG: RideConfig = {
  physics: DEFAULT_PHYSICS,
  mode: 'sim',
  difficulty: 0.75,
  minWatts: 25,
  maxWatts: 300,
  maxRiseWattsPerSec: 20,
  smoothingSec: 2,
  simpleBaseWatts: 100,
  simpleK: 0.1,
  ergWatts: 120,
  staleAfterMs: 3000,
  wheelCircumferenceM: WHEEL_CIRCUMFERENCE_M,
};

export interface RideState {
  /** Spielzeit in s (nur Zeit, in der update lief). */
  timeSec: number;
  /** Tempo in m/s. */
  speed: number;
  /** Zurückgelegte Strecke in m. */
  distance: number;
  /** Positive Höhenmeter. */
  elevationGain: number;
  /** Aktuelle Steigung (echt, nicht skaliert). */
  grade: number;
  /** Zuletzt gemessene Werte (0, wenn veraltet). */
  power: number;
  cadence: number;
  heartRate: number;
  /** Aktuelle Zielwatt für das Gerät (geglättet, begrenzt, auf ganze W gerundet). */
  targetPower: number;
  gearIndex: number;
  gearRatio: number;
}

export class RideEngine {
  readonly config: RideConfig;
  readonly gears: Gearbox;

  private measurement: Measurement | null = null;
  private speed = 0;
  private distance = 0;
  private elevationGain = 0;
  private timeSec = 0;
  private grade = 0;
  /** Geglättete, ungerundete Zielwatt. */
  private target: number;

  constructor(config: Partial<RideConfig> = {}, gears = new Gearbox()) {
    this.config = { ...DEFAULT_RIDE_CONFIG, ...config };
    if (this.config.minWatts > this.config.maxWatts) throw new Error('minWatts > maxWatts');
    this.gears = gears;
    this.target = this.config.minWatts;
  }

  setMeasurement(m: Measurement): void {
    this.measurement = m;
  }

  shiftUp(): void {
    this.gears.up();
  }

  shiftDown(): void {
    this.gears.down();
  }

  setDifficulty(d: number): void {
    this.config.difficulty = Math.min(1, Math.max(0, d));
  }

  setMode(mode: RideMode): void {
    this.config.mode = mode;
  }

  /**
   * Ein Physikschritt.
   * @param dtSec Zeitschritt (z.B. 0.05 bei 20 Hz)
   * @param grade aktuelle Steigung aus der Spielwelt (0.05 = 5 %)
   * @param nowMs aktuelle Zeit für die Prüfung auf veraltete Messwerte
   */
  update(dtSec: number, grade: number, nowMs = Date.now()): RideState {
    const dt = Math.max(0, dtSec);
    this.grade = Number.isFinite(grade) ? grade : 0;
    const { power, cadence } = this.liveValues(nowMs);

    // Fahrdynamik mit gemessener Leistung und echter Steigung
    const prevSpeed = this.speed;
    this.speed = stepSpeed(this.speed, power, this.grade, dt, this.config.physics);
    const ds = ((prevSpeed + this.speed) / 2) * dt;
    this.distance += ds;
    if (this.grade > 0) this.elevationGain += ds * Math.sin(Math.atan(this.grade));
    this.timeSec += dt;

    this.updateTarget(this.rawTarget(cadence), dt);
    return this.state(nowMs);
  }

  state(nowMs = Date.now()): RideState {
    const { power, cadence, heartRate } = this.liveValues(nowMs);
    return {
      timeSec: this.timeSec,
      speed: this.speed,
      distance: this.distance,
      elevationGain: this.elevationGain,
      grade: this.grade,
      power,
      cadence,
      heartRate,
      targetPower: Math.round(this.target),
      gearIndex: this.gears.index,
      gearRatio: this.gears.ratio,
    };
  }

  /** Zielwatt vor Glättung und Begrenzung. */
  private rawTarget(cadence: number): number {
    const c = this.config;
    const feltGrade = this.grade * c.difficulty;
    switch (c.mode) {
      case 'erg':
        return c.ergWatts;
      case 'simple':
        return c.simpleBaseWatts * (1 + c.simpleK * feltGrade * 100);
      case 'sim': {
        if (cadence <= 0) return c.minWatts;
        const wish = speedFromCadence(cadence, this.gears.ratio, c.wheelCircumferenceM);
        return powerRequired(wish, feltGrade, c.physics);
      }
    }
  }

  private updateTarget(raw: number, dt: number): void {
    const c = this.config;
    const goal = Math.min(c.maxWatts, Math.max(c.minWatts, Number.isFinite(raw) ? raw : c.minWatts));
    // Exponentielle Glättung
    const alpha = c.smoothingSec > 0 ? 1 - Math.exp(-dt / c.smoothingSec) : 1;
    let next = this.target + (goal - this.target) * alpha;
    // Absenken: sofort (ohne Glättung), damit es nie unerwartet schwer bleibt
    if (goal < this.target) next = goal;
    // Anstieg begrenzen
    next = Math.min(next, this.target + c.maxRiseWattsPerSec * dt);
    this.target = Math.min(c.maxWatts, Math.max(c.minWatts, next));
  }

  private liveValues(nowMs: number): { power: number; cadence: number; heartRate: number } {
    const m = this.measurement;
    if (!m || nowMs - m.timestamp > this.config.staleAfterMs) {
      return { power: 0, cadence: 0, heartRate: 0 };
    }
    return { power: m.power, cadence: m.cadence, heartRate: m.heartRate };
  }
}
