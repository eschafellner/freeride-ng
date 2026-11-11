import { Emitter } from './emitter';
import { PowerLimiter } from './powerLimiter';
import {
  DEFAULT_POWER_LIMITS,
  type DeviceStatus,
  type Measurement,
  type PowerLimits,
  type TrainerDevice,
  type Unsubscribe,
} from './types';

export interface MockOptions {
  limits?: PowerLimits;
  intervalMs?: number;
  /** Zufallsquelle 0..1, für Tests austauschbar. */
  random?: () => number;
  /** Zeitquelle in ms, für Tests austauschbar. */
  now?: () => number;
}

/**
 * Simulator für die Entwicklung ohne Rad.
 *
 * Verhält sich wie ein Ergometer im ERG-Modus: Sobald getreten wird
 * (Kadenz > 0), folgt die Ist-Leistung mit etwas Trägheit der Zielleistung.
 * Mit `powerOffset` lässt sich zusätzlich "stärker/schwächer treten" simulieren.
 */
export class MockDevice implements TrainerDevice {
  readonly name = 'Simulator';

  private readonly measurements = new Emitter<Measurement>();
  private readonly statuses = new Emitter<DeviceStatus>();
  private readonly limiter: PowerLimiter;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly intervalMs: number;

  private _status: DeviceStatus = 'disconnected';
  private timer: ReturnType<typeof setInterval> | null = null;

  private desiredPower: number;
  /** Simulierte Trittfrequenz (Tastatur). */
  cadence = 0;
  /** Zusätzliche Watt über/unter dem Ziel (Tastatur). */
  powerOffset = 0;

  private power = 0;
  private heartRate = 70;
  private distanceKm = 0;
  private energyKj = 0;
  private startedAt = 0;
  private lastTick = 0;

  constructor(options: MockOptions = {}) {
    this.limiter = new PowerLimiter(options.limits ?? DEFAULT_POWER_LIMITS);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? 1000;
    this.desiredPower = this.limiter.minWatts;
  }

  get status(): DeviceStatus {
    return this._status;
  }

  get sentPower(): number {
    return this.limiter.value;
  }

  onMeasurement(listener: (m: Measurement) => void): Unsubscribe {
    return this.measurements.on(listener);
  }

  onStatus(listener: (s: DeviceStatus) => void): Unsubscribe {
    return this.statuses.on(listener);
  }

  async connect(): Promise<void> {
    if (this.timer) return;
    this.setStatus('connecting');
    this.startedAt = this.lastTick = this.now();
    this.limiter.reset();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.setStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.emergencyStop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus('disconnected');
  }

  setTargetPower(watts: number): void {
    this.desiredPower = this.limiter.clamp(watts);
  }

  emergencyStop(): void {
    this.desiredPower = this.limiter.minWatts;
    this.limiter.reset();
  }

  /** Ein Simulationsschritt; öffentlich, damit Tests ohne Timer auskommen. */
  tick(): Measurement {
    const now = this.now();
    const dt = Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;

    const target = this.limiter.step(this.desiredPower, dt);
    const noise = (spread: number) => (this.random() - 0.5) * 2 * spread;

    const pedalling = this.cadence > 0;
    const goal = pedalling ? Math.max(0, target + this.powerOffset) : 0;
    // Trägheit: Zeitkonstante ~1,5 s
    this.power += (goal - this.power) * (1 - Math.exp(-dt / 1.5));
    const power = pedalling ? Math.max(0, Math.round(this.power + noise(4))) : 0;

    // Puls folgt grob der Leistung
    const hrGoal = 65 + power * 0.35;
    this.heartRate += (hrGoal - this.heartRate) * (1 - Math.exp(-dt / 20));

    // Gerätetempo wie beim Ergometer grob aus der Kadenz
    const speedKmh = pedalling ? Math.round(this.cadence * 0.36 * 10) / 10 : 0;
    this.distanceKm += (speedKmh * dt) / 3600;
    this.energyKj += (power * dt) / 1000;

    const cadence = pedalling ? Math.max(0, Math.round(this.cadence + noise(2))) : 0;

    const m: Measurement = {
      timestamp: now,
      power,
      targetPower: target,
      cadence,
      heartRate: Math.round(this.heartRate + noise(1)),
      speedKmh,
      distanceKm: Math.round(this.distanceKm * 10) / 10,
      energyKj: Math.round(this.energyKj),
      elapsedSec: Math.round((now - this.startedAt) / 1000),
    };
    this.measurements.emit(m);
    return m;
  }

  /**
   * Tastatursteuerung: ↑/↓ Kadenz ±5, ←/→ Leistung ±10 W, 0 = aufhören zu treten.
   * @returns Funktion zum Entfernen der Tastenbelegung
   */
  attachKeyboard(target: Window = window): Unsubscribe {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowUp':
          this.cadence = Math.min(150, this.cadence + 5);
          break;
        case 'ArrowDown':
          this.cadence = Math.max(0, this.cadence - 5);
          break;
        case 'ArrowRight':
          this.powerOffset += 10;
          break;
        case 'ArrowLeft':
          this.powerOffset -= 10;
          break;
        case '0':
          this.cadence = 0;
          this.powerOffset = 0;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  }

  private setStatus(s: DeviceStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.statuses.emit(s);
  }
}
