import { Emitter } from './emitter';
import type { DeviceStatus, Measurement, TrainerDevice, Unsubscribe } from './types';

/**
 * „Kein Gerät“ für den Arcade-Modus: Es wird nichts gesendet und nichts gemessen.
 * Wer dabei auf dem E5 sitzt, regelt den Widerstand am Cockpit selbst.
 */
export class NoDevice implements TrainerDevice {
  readonly name = 'Arcade (ohne Gerät)';
  readonly sentPower = null;
  private _status: DeviceStatus = 'disconnected';
  private readonly statuses = new Emitter<DeviceStatus>();

  get status(): DeviceStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    this.setStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.setStatus('disconnected');
  }

  /** Ohne Gerät gibt es keine Zielleistung: wird ignoriert. */
  setTargetPower(_watts: number): void {}

  emergencyStop(): void {}

  onMeasurement(_listener: (m: Measurement) => void): Unsubscribe {
    return () => {};
  }

  onStatus(listener: (s: DeviceStatus) => void): Unsubscribe {
    return this.statuses.on(listener);
  }

  private setStatus(s: DeviceStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.statuses.emit(s);
  }
}
