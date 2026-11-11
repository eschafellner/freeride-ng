/**
 * Neutrales Geräte-Interface. Nur die Treiber unter src/device/ kennen
 * das Kettler-Protokoll; alles darüber spricht ausschließlich hiermit.
 */

/** Ein Messwert-Paket, wie es das Gerät etwa einmal pro Sekunde liefert. */
export interface Measurement {
  /** Zeitpunkt der Messung (ms seit Epoch). */
  timestamp: number;
  /** Ist-Leistung in Watt. */
  power: number;
  /** Vom Gerät gemeldete Soll-Leistung in Watt. */
  targetPower: number;
  /** Trittfrequenz in U/min. */
  cadence: number;
  /** Puls in Schlägen/min, 0 = kein Signal. */
  heartRate: number;
  /** Vom Gerät angezeigte Geschwindigkeit in km/h (nicht die Spielgeschwindigkeit). */
  speedKmh: number;
  /** Vom Gerät gezählte Distanz in km. */
  distanceKm: number;
  /** Energie in kJ. */
  energyKj: number;
  /** Laufzeit laut Gerät in Sekunden. */
  elapsedSec: number;
}

export type DeviceStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface PowerLimits {
  /** Kleinster Wattwert, den das Gerät akzeptiert. */
  minWatts: number;
  /** Größter Wattwert, den das Gerät akzeptiert. */
  maxWatts: number;
  /** Persönliches Maximum aus den Einstellungen (≤ maxWatts). */
  personalMaxWatts: number;
  /** Schrittweite des Geräts in Watt. */
  stepWatts: number;
  /** Maximaler Anstieg der Zielleistung in Watt pro Sekunde. */
  maxRiseWattsPerSec: number;
}

/**
 * Vorläufige Grenzen. Kettler-Geräte akzeptieren typischerweise 25–400 W
 * in 5-W-Schritten. Für den E5 in Phase 0 zu bestätigen!
 */
export const DEFAULT_POWER_LIMITS: PowerLimits = {
  minWatts: 25,
  maxWatts: 400,
  personalMaxWatts: 300,
  stepWatts: 5,
  maxRiseWattsPerSec: 20,
};

export type Unsubscribe = () => void;

export interface TrainerDevice {
  readonly name: string;
  readonly status: DeviceStatus;
  /** Zuletzt freigegebene bzw. an das Gerät gesendete Zielleistung. */
  readonly sentPower: number | null;

  connect(): Promise<void>;
  /** Setzt die Leistung auf das Minimum und trennt dann die Verbindung. */
  disconnect(): Promise<void>;

  /**
   * Wunsch-Zielleistung. Der Treiber begrenzt den Wert selbst (Min/Max,
   * Schrittweite, Anstiegsrate); der tatsächlich gesendete Wert kann abweichen.
   */
  setTargetPower(watts: number): void;
  /** Sofort auf minimale Leistung, unabhängig von der Anstiegsbegrenzung. */
  emergencyStop(): void;

  onMeasurement(listener: (m: Measurement) => void): Unsubscribe;
  onStatus(listener: (s: DeviceStatus) => void): Unsubscribe;
}
