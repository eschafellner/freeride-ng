import type { TrainerDevice, Unsubscribe } from '../device/types';
import { FixedStepLoop } from './fixedStepLoop';
import type { RideEngine, RideState } from './rideEngine';

export interface RideSessionOptions {
  /** Physiktakt in Hz. */
  physicsHz?: number;
  /** Wie oft Zielwatt an das Gerät gehen, in Hz. Der Treiber drosselt zusätzlich. */
  deviceHz?: number;
  /** Liefert die aktuelle Steigung aus der Spielwelt. */
  gradeProvider?: () => number;
  now?: () => number;
}

/**
 * Verbindet Gerät und Ride-Engine:
 * Messwerte → Engine, Engine (20 Hz) → Zielwatt → Gerät (1 Hz).
 *
 * Die Session treibt keine eigene Uhr: Der Aufrufer ruft `advance(dt)` auf,
 * z.B. aus requestAnimationFrame oder im Test mit fester Zeit.
 */
export class RideSession {
  private readonly loop: FixedStepLoop;
  private readonly deviceIntervalSec: number;
  private readonly gradeProvider: () => number;
  private readonly now: () => number;
  private sinceDevicePush = 0;
  private unsubscribe: Unsubscribe | null = null;
  private paused = false;
  private _state: RideState;

  constructor(
    readonly engine: RideEngine,
    readonly device: TrainerDevice,
    options: RideSessionOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.gradeProvider = options.gradeProvider ?? (() => 0);
    this.deviceIntervalSec = 1 / (options.deviceHz ?? 1);
    this.loop = new FixedStepLoop(1 / (options.physicsHz ?? 20), (dt) => this.step(dt));
    this._state = engine.state(this.now());
  }

  get state(): RideState {
    return this._state;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    this.unsubscribe ??= this.device.onMeasurement((m) => this.engine.setMeasurement(m));
    this.paused = false;
  }

  /** Pause: Physik steht, Gerät sofort aufs Minimum. */
  pause(): void {
    this.paused = true;
    this.device.emergencyStop();
  }

  resume(): void {
    this.paused = false;
    this.loop.reset();
  }

  stop(): void {
    this.pause();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Reale vergangene Zeit in s; führt die fälligen Physikschritte aus. */
  advance(elapsedSec: number): RideState {
    if (!this.paused) this.loop.advance(elapsedSec);
    return this._state;
  }

  private step(dt: number): void {
    this._state = this.engine.update(dt, this.gradeProvider(), this.now());
    this.sinceDevicePush += dt;
    if (this.sinceDevicePush >= this.deviceIntervalSec) {
      this.sinceDevicePush = 0;
      this.device.setTargetPower(this._state.targetPower);
    }
  }
}
