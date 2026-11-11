import { CommandQueue, CommandTimeoutError } from './commandQueue';
import { Emitter } from './emitter';
import { Cmd, KETTLER_BAUD_RATE, LINE_ENDING, LineSplitter, parseStatusLine } from './kettlerProtocol';
import { PowerLimiter } from './powerLimiter';
import {
  DEFAULT_POWER_LIMITS,
  type DeviceStatus,
  type Measurement,
  type PowerLimits,
  type TrainerDevice,
  type Unsubscribe,
} from './types';

export interface RawLine {
  direction: 'tx' | 'rx';
  text: string;
  timestamp: number;
}

export interface KettlerOptions {
  limits?: PowerLimits;
  /** Abfrageintervall für ST. */
  pollIntervalMs?: number;
  /** Mindestabstand zwischen zwei PW-Erhöhungen. Absenken geht immer sofort. */
  minPowerIntervalMs?: number;
  /** Mindeständerung, ab der ein neues PW gesendet wird. */
  minPowerDeltaWatts?: number;
  /** Nach so vielen Zeitüberschreitungen in Folge wird neu verbunden. */
  maxConsecutiveTimeouts?: number;
  commandTimeoutMs?: number;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

export class KettlerSerialDevice implements TrainerDevice {
  readonly name = 'Kettler (Web Serial)';

  private readonly opts: Required<Omit<KettlerOptions, 'limits'>>;
  private readonly limiter: PowerLimiter;
  private readonly measurements = new Emitter<Measurement>();
  private readonly statuses = new Emitter<DeviceStatus>();
  private readonly rawLines = new Emitter<RawLine>();

  private _status: DeviceStatus = 'disconnected';
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;
  private queue: CommandQueue | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wantConnected = false;
  private reconnectAttempt = 0;
  private consecutiveTimeouts = 0;

  private desiredPower: number;
  private lastSentPower: number | null = null;
  private lastSentAt = 0;
  private lastTickAt = 0;

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.emergencyStop();
  };
  private readonly onPageHide = () => {
    void this.writeRaw(Cmd.power(this.limiter.minWatts));
  };

  constructor(options: KettlerOptions = {}) {
    this.opts = {
      pollIntervalMs: options.pollIntervalMs ?? 1000,
      minPowerIntervalMs: options.minPowerIntervalMs ?? 2000,
      minPowerDeltaWatts: options.minPowerDeltaWatts ?? 5,
      maxConsecutiveTimeouts: options.maxConsecutiveTimeouts ?? 3,
      commandTimeoutMs: options.commandTimeoutMs ?? 1500,
    };
    this.limiter = new PowerLimiter(options.limits ?? DEFAULT_POWER_LIMITS);
    this.desiredPower = this.limiter.minWatts;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get status(): DeviceStatus {
    return this._status;
  }

  /** Zuletzt an das Gerät gesendete Zielleistung. */
  get sentPower(): number | null {
    return this.lastSentPower;
  }

  onMeasurement(listener: (m: Measurement) => void): Unsubscribe {
    return this.measurements.on(listener);
  }

  onStatus(listener: (s: DeviceStatus) => void): Unsubscribe {
    return this.statuses.on(listener);
  }

  /** Rohdaten-Mitschnitt (für Phase 0 und Fehlersuche). */
  onRawLine(listener: (l: RawLine) => void): Unsubscribe {
    return this.rawLines.on(listener);
  }

  async connect(): Promise<void> {
    if (!KettlerSerialDevice.isSupported()) {
      throw new Error('Web Serial wird nicht unterstützt (Chrome oder Edge am Desktop nötig).');
    }
    if (this.wantConnected) return;
    this.setStatus('connecting');
    try {
      // requestPort muss aus einer Nutzeraktion heraus aufgerufen werden
      this.port ??= await navigator.serial.requestPort();
      this.wantConnected = true;
      await this.open();
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onPageHide);
    } catch (err) {
      this.wantConnected = false;
      this.setStatus('error');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.stopPolling();
    this.desiredPower = this.limiter.minWatts;
    this.limiter.reset();
    if (this.queue) {
      try {
        // Vor dem Trennen immer auf das Minimum
        await this.queue.sendNext(Cmd.power(this.limiter.minWatts));
      } catch {
        // Gerät antwortet nicht mehr: trotzdem schließen
      }
    }
    await this.close();
    this.setStatus('disconnected');
  }

  setTargetPower(watts: number): void {
    this.desiredPower = this.limiter.clamp(watts);
  }

  emergencyStop(): void {
    this.desiredPower = this.limiter.minWatts;
    const min = this.limiter.reset();
    if (this.queue) {
      this.queue
        .sendNext(Cmd.power(min))
        .then(() => this.markSent(min))
        .catch(() => undefined);
    }
  }

  /**
   * Freier Befehl für die Debug-Konsole. PW ist hier gesperrt, damit die
   * Leistung nur über die begrenzte setTargetPower-Strecke gesetzt wird.
   */
  async sendRaw(command: string): Promise<string> {
    const cmd = command.trim().toUpperCase();
    if (cmd.startsWith('PW')) {
      throw new Error('PW bitte über den Zielwatt-Regler setzen (Sicherheitsgrenzen).');
    }
    if (!this.queue) throw new Error('Nicht verbunden');
    return this.queue.send(cmd);
  }

  // --- intern -------------------------------------------------------------

  private setStatus(s: DeviceStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.statuses.emit(s);
  }

  private async open(): Promise<void> {
    const port = this.port!;
    await port.open({ baudRate: KETTLER_BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
    this.queue = new CommandQueue((c) => this.writeRaw(c), this.opts.commandTimeoutMs);
    this.readLoop = this.runReadLoop(port);

    // PC-Modus. Manche Geräte antworten mit "ACK" oder "RUN", andere gar nicht.
    try {
      await this.queue.send(Cmd.computerMode);
    } catch (err) {
      if (!(err instanceof CommandTimeoutError)) throw err;
    }
    this.limiter.reset();
    await this.sendPower(this.limiter.minWatts);

    this.consecutiveTimeouts = 0;
    this.reconnectAttempt = 0;
    this.lastTickAt = Date.now();
    this.setStatus('connected');
    this.schedulePoll();
  }

  private async close(): Promise<void> {
    this.stopPolling();
    this.queue?.rejectAll(new Error('Verbindung geschlossen'));
    this.queue = null;
    try {
      await this.reader?.cancel();
    } catch {
      // ignorieren
    }
    await this.readLoop?.catch(() => undefined);
    this.readLoop = null;
    try {
      await this.port?.close();
    } catch {
      // Port war schon zu
    }
    this.lastSentPower = null;
  }

  private async runReadLoop(port: SerialPort): Promise<void> {
    const splitter = new LineSplitter();
    const decoder = new TextDecoder();
    if (!port.readable) throw new Error('Port nicht lesbar');
    const reader = port.readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const line of splitter.push(decoder.decode(value, { stream: true }))) {
          this.rawLines.emit({ direction: 'rx', text: line, timestamp: Date.now() });
          this.queue?.handleLine(line);
        }
      }
    } catch (err) {
      console.warn('Lesefehler', err);
      this.scheduleReconnect();
    } finally {
      reader.releaseLock();
      if (this.reader === reader) this.reader = null;
    }
  }

  private async writeRaw(command: string): Promise<void> {
    const writable = this.port?.writable;
    if (!writable) throw new Error('Port nicht beschreibbar');
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(command + LINE_ENDING));
      this.rawLines.emit({ direction: 'tx', text: command, timestamp: Date.now() });
    } finally {
      writer.releaseLock();
    }
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => void this.tick(), this.opts.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async tick(): Promise<void> {
    if (!this.queue || this._status !== 'connected') return;
    try {
      const line = await this.queue.send(Cmd.status);
      const m = parseStatusLine(line);
      if (m) this.measurements.emit(m);
      this.consecutiveTimeouts = 0;
      await this.updatePower();
    } catch (err) {
      if (err instanceof CommandTimeoutError) {
        this.consecutiveTimeouts++;
        if (this.consecutiveTimeouts >= this.opts.maxConsecutiveTimeouts) {
          this.scheduleReconnect();
          return;
        }
      } else if (this._status === 'connected') {
        console.warn('Abfragefehler', err);
      }
    }
    if (this._status === 'connected') this.schedulePoll();
  }

  private async updatePower(): Promise<void> {
    const now = Date.now();
    const dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    const allowed = this.limiter.step(this.desiredPower, dt);
    const last = this.lastSentPower;

    if (last === null) return this.sendPower(allowed);
    if (allowed < last) return this.sendPower(allowed); // leichter: sofort
    const bigEnough = allowed - last >= this.opts.minPowerDeltaWatts;
    const longEnough = now - this.lastSentAt >= this.opts.minPowerIntervalMs;
    if (bigEnough && longEnough) await this.sendPower(allowed);
  }

  private async sendPower(watts: number): Promise<void> {
    if (!this.queue) return;
    await this.queue.send(Cmd.power(watts));
    this.markSent(watts);
  }

  private markSent(watts: number): void {
    this.lastSentPower = watts;
    this.lastSentAt = Date.now();
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this._status === 'reconnecting') return;
    this.setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt++;
    setTimeout(() => {
      void (async () => {
        if (!this.wantConnected) return;
        await this.close();
        try {
          await this.open();
        } catch (err) {
          console.warn('Neuverbindung fehlgeschlagen', err);
          this._status = 'error';
          this.scheduleReconnect();
        }
      })();
    }, delay);
  }
}
